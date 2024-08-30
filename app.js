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
    let userId;
    let userProfileId;

    try {
      const userResponse = await axios.get(`${STRAPI_URL}/api/users`, {
        params: {
          filters: {
            email: {
              $eq: userEmail
            }
          }
        },
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('User response:', userResponse.data);

      if (userResponse.data && userResponse.data.data && userResponse.data.data.length > 0) {
        userId = userResponse.data.data[0].id;
        console.log('Existing user found, ID:', userId);

        console.log('Searching for UserProfile');
        const userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles`, {
          params: {
            filters: {
              user: {
                id: {
                  $eq: userId
                }
              }
            }
          },
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('UserProfile response:', userProfileResponse.data);

        if (userProfileResponse.data && userProfileResponse.data.data && userProfileResponse.data.data.length > 0) {
          userProfileId = userProfileResponse.data.data[0].id;
          console.log('Updating existing UserProfile, ID:', userProfileId);
          const updateResponse = await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
            data: {
              amountDonated: (userProfileResponse.data.data[0].attributes.amountDonated || 0) + amount,
              totalPoints: (userProfileResponse.data.data[0].attributes.totalPoints || 0) + totalPoints,
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
          userProfileId = userProfileCreateResponse.data.data.id; // Ensure correct path to ID
        }
      } else {
        console.log('Creating new user');
        const randomPassword = crypto.randomBytes(8).toString('hex');
        const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
          email: userEmail,
          username: payload.name_first || userEmail,
          password: randomPassword,
          role: ''  // Ensure role field is provided
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
        userProfileId = userProfileCreateResponse.data.data.id; // Ensure correct path to ID
      }
    } catch (error) {
      console.error('Error during user or user profile creation:', error.response ? error.response.data : error.message);
      return res.status(500).send('Internal Server Error');
    }

    if (!userProfileId) {
      throw new Error('UserProfile ID is not set');
    }

    console.log('Searching for Biome');
    let biomeId;
    try {
      const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes`, {
        params: {
          filters: {
            name: {
              $eq: biomeName
            }
          }
        },
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('Biome response:', biomeResponse.data);

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
    } catch (error) {
      console.error('Error during biome handling:', error.response ? error.response.data : error.message);
      return res.status(500).send('Internal Server Error');
    }

    console.log('Creating Donation');
    let donationId;
    try {
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
      donationId = donationResponse.data.data.id;
    } catch (error) {
      console.error('Error creating donation:', error.response ? error.response.data : error.message);
      return res.status(500).send('Internal Server Error');
    }

    // Handle GiftDonation
    if (friendName && friendEmail) {
      console.log('Creating GiftDonation');
      try {
        await axios.post(`${STRAPI_URL}/api/gift-donations`, {
          data: {
            amount: amount,
            donationDate: billingDateStr || new Date().toLocaleDateString('en-GB'),
            userProfile: userProfileId,
            biome: biomeId,
            friendName: friendName,
            friendEmail: friendEmail
          }
        }, {
          headers: {
            'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('GiftDonation creation response: Success');
      } catch (error) {
        console.error('Error creating GiftDonation:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }
    }

    console.log('Associating CardsCollected');
    try {
      const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards-collecteds`, {
        params: {
          filters: {
            pointsRequired: {
              $lte: totalPoints
            }
          }
        },
        headers: {
          'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('Cards response:', cardsResponse.data);

      if (cardsResponse.data && cardsResponse.data.data && cardsResponse.data.data.length > 0) {
        for (const card of cardsResponse.data.data) {
          // Create a new CardsCollected association
          await axios.post(`${STRAPI_URL}/api/cards-collecteds`, {
            data: {
              user: userId,
              card: card.id
            }
          }, {
            headers: {
              'Authorization': `Bearer ${STRAPI_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });
        }
        console.log('CardsCollected association complete');
      } else {
        console.warn('No cards found for the given totalPoints');
      }
    } catch (error) {
      console.error('Error fetching or associating cards:', error.response ? error.response.data : error.message);
      return res.status(500).send('Internal Server Error');
    }

    res.status(200).send('Success');
  } catch (error) {
    console.error('General error:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
