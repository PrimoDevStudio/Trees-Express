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

    console.log('Searching for user');
    const userResponse = await axios.get(`${STRAPI_URL}/api/users?filters[email][$eq]=${userEmail}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('User response:', userResponse.data);

    let userId;
    let userProfileId;

    if (userResponse.data && userResponse.data.length > 0) {
      userId = userResponse.data[0].id;
      console.log('Existing user found, ID:', userId);

      console.log('Searching for UserProfile');
      const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][id][$eq]=${userId}`, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('UserProfile response:', userProfileResponse.data);

      if (userProfileResponse.data && userProfileResponse.data.length > 0) {
        userProfileId = userProfileResponse.data[0].id;
        console.log('Updating existing UserProfile, ID:', userProfileId);
        const updateResponse = await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
          data: {
            amountDonated: (userProfileResponse.data[0].amountDonated || 0) + amount,
            totalPoints: (userProfileResponse.data[0].totalPoints || 0) + totalPoints,
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
        console.log('Creating new UserProfile for existing user');
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
        userProfileId = userProfileCreateResponse.data.id;
      }
    } else {
      console.log('Creating new user');
      const randomPassword = crypto.randomBytes(8).toString('hex');
      const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
        email: userEmail,
        username: payload.name_first || userEmail,
        password: randomPassword,
        role: ''
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
      userProfileId = userProfileCreateResponse.data.id;
    }

    console.log('Searching for Biome');
    const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes?filters[name][$eq]=${encodeURIComponent(biomeName)}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Biome response:', biomeResponse.data);

    let biomeId;
    if (biomeResponse.data && biomeResponse.data.data && biomeResponse.data.data.length > 0) {
      biomeId = biomeResponse.data.data[0].id;
      console.log('Updating existing Biome, ID:', biomeId);
      const biomeUpdateResponse = await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
        data: {
          totalDonated: (biomeResponse.data.data[0].attributes.totalDonated || 0) + amount
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('Biome update response:', biomeUpdateResponse.data);
    } else {
      console.error(`Biome "${biomeName}" not found. Donation cannot be processed.`);
      throw new Error(`Biome "${biomeName}" not found`);
    }

    console.log('Creating Donation');
    const donationResponse = await axios.post(`${STRAPI_URL}/api/donations`, {
      data: {
        amount: amount,
        donationDate: billingDateStr || new Date().toLocaleDateString('en-GB'),
        userProfile: userProfileId || null,
        biome: biomeId
      }
    }, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Donation creation response:', donationResponse.data);

    console.log('ITN processing completed successfully');
    res.status(200).send('Donation processed successfully');
  } catch (error) {
    console.error('Error processing ITN:', error.response ? error.response.data : error.message);
    if (error.response && error.response.data && error.response.data.error && error.response.data.error.details) {
      console.error('Validation errors:', error.response.data.error.details.errors);
    }
    console.error('Full error object:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => console.log(`ITN handler listening on port ${PORT}`));