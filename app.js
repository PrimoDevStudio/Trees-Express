const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const he = require('he'); // HTML Entity Decoder

const app = express();
const PORT = process.env.PORT || 3001;
const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;
const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_PASS_PHRASE = process.env.PAYFAST_PASS_PHRASE;
const PAYFAST_API_URL = process.env.PAYFAST_API_URL;
const PAYFAST_API_VERSION = 'v1';

const upload = multer({ storage: multer.memoryStorage() });

app.use(bodyParser.json());
app.use(cors({
  origin: STRAPI_URL
}));

// Log incoming requests
app.use((req, res, next) => {
  console.log('Incoming request headers:', req.headers);
  next();
});

app.post('/process-itn', upload.none(), async (req, res) => {
  console.log('Processing ITN request');
  try {
    console.log('Received payload (raw):', req.body);
    const decodedBody = {};
    for (const [key, value] of Object.entries(req.body)) {
      decodedBody[key] = he.decode(value);
    }
    console.log('Received payload (decoded):', decodedBody);
    const payload = decodedBody;

    const userEmail = payload.email_address;
    const biomeName = payload.custom_str3 || '';
    const amount = parseFloat(payload.amount_gross) || 0;
    const token = payload.token || '';
    const friendName = payload.custom_str1 || '';
    const friendEmail = payload.custom_str2 || '';
    const billingDateStr = payload.billing_date || new Date().toISOString();
    const totalPoints = parseInt(payload.custom_int1, 10) || 0;

    console.log('Extracted data:', { userEmail, biomeName, amount, token, friendName, friendEmail, billingDateStr, totalPoints });

    if (!userEmail) {
      console.error('No valid user email provided');
      return res.status(400).send('Bad Request: Missing user email');
    }

    // Check if the user exists
    let userId;
    let userProfileId;
    console.log('Searching for user');
    const userResponse = await axios.get(`${STRAPI_URL}/api/users?filters[email][$eq]=${encodeURIComponent(userEmail)}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('User response:', userResponse.data);

    if (userResponse.data && userResponse.data.length > 0) {
      // User exists
      userId = userResponse.data[0].id;
      console.log('Existing user found, ID:', userId);

      // Check if UserProfile exists
      console.log('Searching for UserProfile');
      const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][id][$eq]=${userId}&populate=*`, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('UserProfile response:', userProfileResponse.data);

      if (userProfileResponse.data && userProfileResponse.data.data.length > 0) {
        // UserProfile exists
        userProfileId = userProfileResponse.data.data[0].id;
        console.log('Updating existing UserProfile, ID:', userProfileId);
        
        // Get existing subscriptions
        const existingSubscriptions = userProfileResponse.data.data[0].attributes.subscriptions || [];
        
        // Add new subscription
        existingSubscriptions.push({
          token: token,
          amount: amount
        });

        const updateResponse = await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
          data: {
            amountDonated: (userProfileResponse.data.data[0].attributes.amountDonated || 0) + amount,
            totalPoints: (userProfileResponse.data.data[0].attributes.totalPoints || 0) + totalPoints,
            subscriptions: existingSubscriptions,
            friendName: friendName,
            friendEmail: friendEmail,
            billingDate: billingDateStr
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('UserProfile update response:', updateResponse.data);
      } else {
        console.log('Creating UserProfile for existing user');
        const userProfileCreateResponse = await axios.post(`${STRAPI_URL}/api/user-profiles`, {
          data: {
            amountDonated: amount,
            totalPoints: totalPoints,
            user: userId,
            subscriptions: [
              {
                token: token,
                amount: amount
              }
            ],
            friendName: friendName,
            friendEmail: friendEmail,
            billingDate: billingDateStr
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('New UserProfile creation response:', userProfileCreateResponse.data);
        userProfileId = userProfileCreateResponse.data.data.id;
      }
    } else {
      // User does not exist
      console.log('Creating new user');
      const randomPassword = crypto.randomBytes(8).toString('hex');
      const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
        email: userEmail,
        username: payload.name_first || userEmail,
        password: randomPassword,
        role: {
          connect: [{ id: 1 }]
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('New user creation response:', userCreateResponse.data);
      userId = userCreateResponse.data.id;

      console.log('Creating UserProfile for new user');
      const userProfileCreateResponse = await axios.post(`${STRAPI_URL}/api/user-profiles`, {
        data: {
          amountDonated: amount,
          totalPoints: totalPoints,
          user: userId,
          subscriptions: [
            {
              token: token,
              amount: amount
            }
          ],
          friendName: friendName,
          friendEmail: friendEmail,
          billingDate: billingDateStr
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('New UserProfile creation response:', userProfileCreateResponse.data);
      userProfileId = userProfileCreateResponse.data.data.id;
    }

    // Associate user_profile with user
    await axios.put(`${STRAPI_URL}/api/users/${userId}`, {
      user_profile: userProfileId
    }, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Handle Biome
    console.log('Searching for Biome:', biomeName);
    const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('All Biomes response:', biomeResponse.data);

    let biomeId;
    const matchingBiome = biomeResponse.data.data.find(biome =>
      biome.attributes.name.trim().toLowerCase() === biomeName.trim().toLowerCase()
    );

    if (matchingBiome) {
      biomeId = matchingBiome.id;
      console.log('Matching Biome found, ID:', biomeId);
      console.log('Updating existing Biome');
      const biomeUpdateResponse = await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
        data: {
          totalDonated: (matchingBiome.attributes.totalDonated || 0) + amount,
          users: { connect: [{ id: userId }] }
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('Biome update response:', biomeUpdateResponse.data);
    } else {
      console.error(`Biome "${biomeName}" not found. Available biomes:`, biomeResponse.data.data.map(b => b.attributes.name));
      return res.status(404).send(`Biome "${biomeName}" not found`);
    }

    // Create Donation
    console.log('Creating Donation');
    const donationResponse = await axios.post(`${STRAPI_URL}/api/donations`, {
      data: {
        amount: amount,
        donationDate: billingDateStr,
        user: { connect: [{ id: userId }] },
        biome: { connect: [{ id: biomeId }] }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Donation creation response:', donationResponse.data);

    // Handle GiftDonation if present
    let giftDonationResponse;
    if (friendName && friendEmail) {
      console.log('Creating GiftDonation');
      giftDonationResponse = await axios.post(`${STRAPI_URL}/api/gift-donations`, {
        data: {
          amount: amount,
          donationDate: billingDateStr,
          user: { connect: [{ id: userId }] },
          biome: { connect: [{ id: biomeId }] },
          friendName: friendName,
          friendEmail: friendEmail
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('GiftDonation creation response:', giftDonationResponse.data);
    }

    // Update User with new donations and gift donations
    const userUpdateData = {
      donations: { connect: [{ id: donationResponse.data.data.id }] }
    };
    if (giftDonationResponse) {
      userUpdateData.gift_donations = { connect: [{ id: giftDonationResponse.data.data.id }] };
    }
    await axios.put(`${STRAPI_URL}/api/users/${userId}`, userUpdateData, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Update Biome with new donations and gift donations
    const biomeUpdateData = {
      data: {
        donations: { connect: [{ id: donationResponse.data.data.id }] }
      }
    };
    if (giftDonationResponse) {
      biomeUpdateData.data.gift_donations = { connect: [{ id: giftDonationResponse.data.data.id }] };
    }
    await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, biomeUpdateData, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Fetch User Profile to get the total points
    console.log('Fetching user profile to get total points');
    const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const currentTotalPoints = userProfileResponse.data.data.attributes.totalPoints;

    console.log('Current total points for the user:', currentTotalPoints);

    // Fetch All Cards
    console.log('Fetching all CardsCollected');
    const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards-collecteds`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('All Cards response:', cardsResponse.data);

    // Associate all cards based on totalPoints
    for (const card of cardsResponse.data.data) {
      if (currentTotalPoints >= card.attributes.pointsRequired) {
        console.log(`Associating card ID: ${card.id} with user ID: ${userId}`);
        // Associate the card with the user
        await axios.put(`${STRAPI_URL}/api/cards-collecteds/${card.id}`, {
          data: {
            users: { connect: [{ id: userId }] }
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    console.log('ITN process completed successfully');
    res.status(200).send('ITN Processed');
  } catch (error) {
    console.error('Error processing ITN:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Function to generate the current ISO-8601 timestamp in the required format
const getIso8601Timestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  // Get timezone offset in hours and minutes
  const offset = now.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
  const offsetSign = offset > 0 ? '-' : '+';
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
};

// Signature generation function
const generatePayFastApiSignature = (data, passPhrase) => {
  // Ensure all values are strings and trimmed
  let pfData = Object.entries(data).reduce((acc, [key, value]) => {
    acc[key] = typeof value === 'boolean' ? value.toString() : String(value).trim();
    return acc;
  }, {});

  // Remove signature if it exists
  delete pfData.signature;

  // Sort keys alphabetically
  const sortedKeys = Object.keys(pfData).sort();

  // Create parameter string in the correct format
  let pfParamString = sortedKeys
    .map((key) => `${key}=${encodeURIComponent(pfData[key]).replace(/%20/g, '+')}`)
    .join('&');

  // Always append the passphrase
  pfParamString += `&passphrase=${encodeURIComponent(passPhrase.trim()).replace(/%20/g, '+')}`;

  // Log the parameter string for verification
  console.log('Decoded Parameter String for Verification:', pfParamString);

  // Generate MD5 hash of the string and convert to lowercase
  return crypto.createHash('md5').update(pfParamString).digest('hex').toLowerCase();
};

// Route to handle subscription cancellation
app.post('/cancel-subscription', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: 'Subscription token is required' });
  }

  try {
    const timestamp = getIso8601Timestamp(); // Use your existing timestamp function

    const data = {
      'merchant-id': PAYFAST_MERCHANT_ID,
      version: PAYFAST_API_VERSION,
      timestamp: timestamp,
    };

    // Passphrase is always provided
    const signature = generatePayFastApiSignature(data, PAYFAST_PASS_PHRASE);

    const headers = {
      'merchant-id': PAYFAST_MERCHANT_ID,
      version: PAYFAST_API_VERSION,
      timestamp: timestamp,
      signature: signature,
    };

    console.log('Request Headers:', headers);

    // API URL
    const url = `${PAYFAST_API_URL}/subscriptions/${token}/cancel?testing=true`;

    console.log('Request URL:', url);

    // Sending the request to PayFast
    const response = await axios.put(url, {}, { headers });

    console.log('PayFast Response:', response.data);

    if (response.data && response.data.status === 'success') {
      res.status(200).json({ message: 'Subscription cancelled successfully', data: response.data });
    } else {
      res.status(500).json({ message: 'Failed to cancel subscription', data: response.data });
    }
  } catch (error) {
    console.error('Error canceling subscription:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error canceling subscription', error: error.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});