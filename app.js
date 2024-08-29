const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const he = require('he'); // HTML Entity Decoder

const app = express();

// Railway automatically provides the PORT environment variable
const PORT = process.env.PORT || 3001;

// Use environment variables provided by Railway
const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

// Configure multer
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(bodyParser.json()); // For parsing application/json
app.use(cors({
  origin: STRAPI_URL
}));

// Log incoming requests
app.use((req, res, next) => {
  console.log('Incoming request headers:', req.headers);
  next();
});

app.post('/process-itn', upload.none(), async (req, res) => {
  try {
    // Log raw request body for debugging
    console.log('Received payload (raw):', req.body);

    // Decode the HTML entities in the payload
    const decodedBody = {};
    for (const [key, value] of Object.entries(req.body)) {
      decodedBody[key] = he.decode(value);
    }

    console.log('Received payload (decoded):', decodedBody); // Log the decoded payload

    const payload = decodedBody;

    // Safely extract and handle payload values
    const userEmail = payload.custom_str2 || ''; // Default to empty string if not present
    const biomeName = payload.custom_str3 || ''; // Default to empty string if not present
    const amount = parseFloat(payload.amount_gross) || 0; // Default to 0 if not a valid number
    const token = payload.token || ''; // Default to empty string if not present
    const friendName = payload.custom_str1 || ''; // Default to empty string if not present

    if (userEmail) {
      // Find the user by email
      const userResponse = await axios.get(`${STRAPI_URL}/api/users?filters[email][$eq]=${userEmail}`, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('User response:', userResponse.data);

      let userId;
      if (userResponse.data.data && userResponse.data.data.length > 0) {
        userId = userResponse.data.data[0].id;

        // If user exists, find the associated UserProfile
        const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles?filters[user][$eq]=${userId}`, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('UserProfile response:', userProfileResponse.data);

        let userProfileId;
        if (userProfileResponse.data.data && userProfileResponse.data.data.length > 0) {
          userProfileId = userProfileResponse.data.data[0].id;

          // Update UserProfile with new donation details
          await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
            data: {
              amountDonated: (userProfileResponse.data.data[0].amountDonated || 0) + amount,
              totalPoints: (userProfileResponse.data.data[0].totalPoints || 0) + (payload.custom_int1 || 0),
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
    } else {
      console.error('No valid user email provided');
      return res.status(400).send('Bad Request: Missing user email');
    }

    // Find or create biome
    const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes?filters[name][$eq]=${biomeName}`, {
      headers: {
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Biome response:', biomeResponse.data);

    let biomeId;
    if (biomeResponse.data.data && biomeResponse.data.data.length > 0) {
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
        donationDate: payload.billing_date || new Date().toISOString(), // Default to current date if missing
        userProfile: userProfileId || null, // Handle missing userProfileId
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
    console.error('Error processing ITN:', error.response ? error.response.data : error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => console.log(`ITN handler listening on port ${PORT}`));
