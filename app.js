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
    const decodedBody = {};
    for (const [key, value] of Object.entries(req.body)) {
      decodedBody[key] = he.decode(value);
    }
    
    const { email_address: userEmail, custom_str1: friendName, custom_str2: friendEmail, amount_gross: amountGross, billing_date: billingDateStr, custom_int1: customTotalPoints, token } = decodedBody;
    const amount = parseFloat(amountGross) || 0;
    const totalPoints = parseInt(customTotalPoints, 10) || 0;  // Use totalPoints here

    // Find or create the user
    const userResponse = await axios.get(`${STRAPI_URL}/api/users?filters[email][$eq]=${userEmail}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let userId;
    if (userResponse.data && userResponse.data.length > 0) {
      userId = userResponse.data[0].id;
    } else {
      const randomPassword = crypto.randomBytes(8).toString('hex');
      const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
        email: userEmail,
        username: userEmail.split('@')[0],
        password: randomPassword,
        role: ''
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      userId = userCreateResponse.data.id;
    }

    // Find or create UserProfile
    const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][id][$eq]=${userId}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let userProfileId;
    if (userProfileResponse.data && userProfileResponse.data.data.length > 0) {
      userProfileId = userProfileResponse.data.data[0].id;
      await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
        data: {
          amountDonated: (userProfileResponse.data.data[0].attributes.amountDonated || 0) + amount,
          totalPoints: (userProfileResponse.data.data[0].attributes.totalPoints || 0) + totalPoints,
          token: token,
          friendName: friendName,
          friendEmail: friendEmail,
          billingDate: billingDateStr,
          user: userId
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
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
      userProfileId = userProfileCreateResponse.data.id;
    }

    // Find or create Biome
    const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes?filters[name][$eq]=${encodeURIComponent(biomeName)}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let biomeId;
    if (biomeResponse.data && biomeResponse.data.data && biomeResponse.data.data.length > 0) {
      biomeId = biomeResponse.data.data[0].id;
      await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
        data: {
          totalDonated: (biomeResponse.data.data[0].attributes.totalDonated || 0) + amount
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      console.error(`Biome "${biomeName}" not found. Donation cannot be processed.`);
      throw new Error(`Biome "${biomeName}" not found`);
    }

    // Create GiftDonation if applicable
    if (friendName && friendEmail) {
      await axios.post(`${STRAPI_URL}/api/gift-donations`, {
        data: {
          amount: amount,
          token: token,
          friendName: friendName,
          friendEmail: friendEmail,
          billingDate: billingDateStr,
          userProfile: userProfileId
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Donation and relate it to UserProfile and Biome
    const donationResponse = await axios.post(`${STRAPI_URL}/api/donations`, {
      data: {
        amount: amount,
        donationDate: billingDateStr || new Date().toLocaleDateString('en-GB'),
        userProfile: userProfileId,
        biome: biomeId
      }
    }, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Handle Cards Collected
    const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const cardsToAssign = cardsResponse.data.filter(card => totalPoints >= card.attributes.pointsRequired);

    if (cardsToAssign.length > 0) {
      await axios.post(`${STRAPI_URL}/api/cards-collecteds`, {
        data: {
          userProfile: userProfileId,
          cards: cardsToAssign.map(card => card.id)
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      console.log('No cards to assign based on totalPoints.');
    }

    res.status(200).send('ITN processing completed successfully');
  } catch (error) {
    console.error('Error processing ITN:', error);
    res.status(500).send('Error processing ITN');
  }
});

app.listen(PORT, () => console.log(`ITN handler listening on port ${PORT}`));
