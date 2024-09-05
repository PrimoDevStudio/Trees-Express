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
    const billingDateStr = payload.billing_date || '';
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
      const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][id][$eq]=${userId}`, {
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
        const updateResponse = await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
          data: {
            amountDonated: {
              $add: amount
            },
            totalPoints: {
              $add: totalPoints
            },
            token: token,
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
            token: token,
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
          token: token,
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
      
      // Check if user is already associated with the Biome
      const isUserAssociated = matchingBiome.attributes.users.data.some(user => user.id === userId);
      
      const biomeUpdateResponse = await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
        data: {
          totalDonated: {
            $add: amount
          },
          users: isUserAssociated ? undefined : { connect: [{ id: userId }] }
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
        donationDate: billingDateStr || new Date().toISOString(),
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
          donationDate: billingDateStr || new Date().toISOString(),
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

    // Associate CardsCollected based on totalPoints
    console.log('Associating CardsCollected');
    const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards-collecteds?filters[pointsRequired][$lte]=${totalPoints}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Cards response:', cardsResponse.data);

    if (cardsResponse.data && cardsResponse.data.data.length > 0) {
      for (const card of cardsResponse.data.data) {
        // Check if the user already has this card
        const userHasCard = card.attributes.users.data.some(user => user.id === userId);
        
        if (!userHasCard) {
          console.log(`Associating card ID: ${card.id} with user ID: ${userId}`);
          const cardAssociationResponse = await axios.put(`${STRAPI_URL}/api/cards-collecteds/${card.id}`, {
            data: {
              users: { connect: [{ id: userId }] }
            }
          }, {
            headers: {
              'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });
          console.log('Card association response:', cardAssociationResponse.data);
        } else {
          console.log(`User already has card ID: ${card.id}`);
        }
      }
    }

    console.log('ITN process completed successfully');
    res.status(200).send('ITN Processed');
  } catch (error) {
    console.error('Error processing ITN:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});