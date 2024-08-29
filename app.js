const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Railway automatically provides the PORT environment variable
const PORT = process.env.PORT || 3001;

// Use environment variables provided by Railway
const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// CORS configuration
app.use(cors({
  origin: STRAPI_URL
}));

app.post('/process-itn', async (req, res) => {
  try {
    const payload = req.body;

    // Validate the payload (check signature, etc.)
    // This is crucial for security!

    const userEmail = payload.custom_str2;
    const biomeName = payload.custom_str3;
    const amount = parseFloat(payload.amount_gross);
    const token = payload.token;
    const friendName = payload.custom_str1;

    // Find the user by email
    const userResponse = await axios.get(`${STRAPI_URL}/api/users?filters[email][$eq]=${userEmail}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let userId;
    if (userResponse.data.data.length > 0) {
      userId = userResponse.data.data[0].id;

      // If user exists, find the associated UserProfile
      const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][$eq]=${userId}`, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      let userProfileId;
      if (userProfileResponse.data.data.length > 0) {
        userProfileId = userProfileResponse.data.data[0].id;

        // Update UserProfile with new donation details
        await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
          data: {
            amountDonated: userProfileResponse.data.data[0].amountDonated + amount,
            totalPoints: userProfileResponse.data.data[0].totalPoints + (payload.custom_int1 || 0),
            token: token,
            friendName: friendName
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
      } else {
        // Create a new UserProfile if not exists
        const userProfileCreateResponse = await axios.post(`${STRAPI_URL}/api/user-profiles`, {
          data: {
            amountDonated: amount,
            totalPoints: payload.custom_int1 || 0,
            user: userId,
            token: token,
            friendName: friendName
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        userProfileId = userProfileCreateResponse.data.data.id;
      }
    } else {
      // Create a new user if not exists
      const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
        data: {
          email: userEmail,
          username: payload.name_first || userEmail
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      userId = userCreateResponse.data.data.id;

      // Create a UserProfile for the new user
      await axios.post(`${STRAPI_URL}/api/user-profiles`, {
        data: {
          amountDonated: amount,
          totalPoints: payload.custom_int1 || 0,
          user: userId,
          token: token,
          friendName: friendName
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    }

    // Find or create biome
    const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes?filters[name][$eq]=${biomeName}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let biomeId;
    if (biomeResponse.data.data.length > 0) {
      biomeId = biomeResponse.data.data[0].id;
    } else {
      const biomeCreateResponse = await axios.post(`${STRAPI_URL}/api/biomes`, {
        data: {
          name: biomeName
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      biomeId = biomeCreateResponse.data.data.id;
    }

    // Create a donation
    await axios.post(`${STRAPI_URL}/api/donations`, {
      data: {
        amount: amount,
        donationDate: payload.billing_date,
        userProfile: userProfileId,
        biome: biomeId
      }
    }, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    res.status(200).send('Donation processed successfully');
  } catch (error) {
    console.error('Error processing ITN:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => console.log(`ITN handler listening on port ${PORT}`));
