const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
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

    // Extract payload values
    const userEmail = payload.email_address;
    const biomeName = payload.custom_str3 || '';
    const amount = parseFloat(payload.amount_gross) || 0;
    const token = payload.token || '';
    const friendName = payload.custom_str1 || '';
    const friendEmail = payload.custom_str2 || ''; // Correctly extracting friendEmail
    const billingDateStr = payload.billing_date || '';
    
    // Convert billing_date to Strapi date format (DD/MM/YYYY)
    const billingDate = billingDateStr ? new Date(billingDateStr).toLocaleDateString('en-GB') : '';

    // Convert custom_int1 to float
    const totalPoints = parseFloat(payload.custom_int1) || 0;

    console.log('Extracted data:', { userEmail, biomeName, amount, token, friendName, friendEmail, billingDate, totalPoints });

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
              totalPoints: (userProfileResponse.data.data[0].totalPoints || 0) + totalPoints,
              token: token,
              friendName: friendName,
              friendEmail: friendEmail, // Include friendEmail here
              billingDate: billingDate
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
              totalPoints: totalPoints,
              user: userId,
              token: token,
              friendName: friendName,
              friendEmail: friendEmail, // Include friendEmail here
              billingDate: billingDate
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
        const randomPassword = crypto.randomBytes(8).toString('hex'); // Generate a random password

        const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
          data: {
            email: userEmail,
            username: payload.name_first || userEmail,
            password: randomPassword,
            role: '' // Set role to empty string to default to authenticated
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
            totalPoints: totalPoints,
            user: userId,
            token: token,
            friendName: friendName,
            friendEmail: friendEmail, // Include friendEmail here
            billingDate: billingDate
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
      
      // Update existing biome with new donation details
      await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
        data: {
          totalDonated: (biomeResponse.data.data[0].totalDonated || 0) + amount
        }
      }, {
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      // Create a new biome if not exists
      const biomeCreateResponse = await axios.post(`${STRAPI_URL}/api/biomes`, {
        data: {
          name: biomeName,
          description: '', // Default value if not provided
          totalDonated: amount
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
        donationDate: billingDate || new Date().toLocaleDateString('en-GB'), // Default to current date if missing
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
    if (error.response && error.response.data && error.response.data.error && error.response.data.error.details) {
      console.error('Validation errors:', error.response.data.error.details.errors);
    }
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => console.log(`ITN handler listening on port ${PORT}`));
