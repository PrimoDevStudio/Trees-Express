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

app.post('/process-itn', upload.none(), async (req, res) => {
  console.log('Processing ITN request');
  try {
    // Decode HTML entities in the payload
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

    if (!userEmail) {
      console.error('No valid user email provided');
      return res.status(400).send('Bad Request: Missing user email');
    }

    let userId;
    let userProfileId;

    // Check for existing user
    let userResponse;
    try {
      userResponse = await axios.get(`${STRAPI_URL}/api/users`, {
        params: { filters: { email: { $eq: userEmail } } },
        headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error fetching user:', error.response ? error.response.data : error.message);
      return res.status(500).send('Internal Server Error');
    }

    if (userResponse.data && userResponse.data.data && userResponse.data.data.length > 0) {
      userId = userResponse.data.data[0].id;
      console.log('Existing user found, ID:', userId);

      // Check for existing UserProfile
      let userProfileResponse;
      try {
        userProfileResponse = await axios.get(`${STRAPI_URL}/api/user-profiles`, {
          params: { filters: { user: { id: { $eq: userId } } } },
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error fetching user profile:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }

      if (userProfileResponse.data && userProfileResponse.data.data && userProfileResponse.data.data.length > 0) {
        userProfileId = userProfileResponse.data.data[0].id;
        console.log('Updating existing UserProfile, ID:', userProfileId);
        await axios.put(`${STRAPI_URL}/api/user-profiles/${userProfileId}`, {
          data: {
            amountDonated: (userProfileResponse.data.data[0].attributes.amountDonated || 0) + amount,
            totalPoints: (userProfileResponse.data.data[0].attributes.totalPoints || 0) + totalPoints,
            token: token,
            billingDate: token ? billingDateStr : undefined
          }
        }, {
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
      } else {
        console.error('UserProfile not found for existing user');
        return res.status(404).send('UserProfile not found for existing user');
      }

      // Create new Donation for existing user
      let donationId;
      try {
        const donationResponse = await axios.post(`${STRAPI_URL}/api/donations`, {
          data: {
            amount: amount,
            donationDate: billingDateStr || new Date().toLocaleDateString('en-GB'),
            userProfile: userProfileId,
            biome: biomeId // This should be set below after finding/creating biome
          }
        }, {
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        donationId = donationResponse.data.data.id;
      } catch (error) {
        console.error('Error creating donation:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }

      // Create GiftDonation if applicable
      if (friendName && friendEmail) {
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
            headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error creating GiftDonation:', error.response ? error.response.data : error.message);
          return res.status(500).send('Internal Server Error');
        }
      }

      // Handle Biome update
      let biomeId;
      try {
        const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes`, {
          params: { filters: { name: { $eq: biomeName } } },
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        if (biomeResponse.data && biomeResponse.data.data && biomeResponse.data.data.length > 0) {
          biomeId = biomeResponse.data.data[0].id;
          await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
            data: {
              totalDonated: (biomeResponse.data.data[0].attributes.totalDonated || 0) + amount
            }
          }, {
            headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
          });
        } else {
          console.error('Biome not found:', biomeName);
          return res.status(404).send('Biome not found');
        }
      } catch (error) {
        console.error('Error handling biome:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }

      // Handle CardsCollected
      try {
        const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards`, {
          params: { filters: { pointsRequired: { $lte: totalPoints } } },
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        if (cardsResponse.data && cardsResponse.data.data && cardsResponse.data.data.length > 0) {
          for (const card of cardsResponse.data.data) {
            await axios.post(`${STRAPI_URL}/api/cards-collecteds`, {
              data: {
                card: card.id,
                user: userId // Directly associated with User
              }
            }, {
              headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
            });
          }
        } else {
          console.error('No cards found for the given points');
          return res.status(404).send('No cards found for the given points');
        }
      } catch (error) {
        console.error('Error fetching or creating cards collected:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }

    } else {
      console.log('Creating new user');
      const randomPassword = crypto.randomBytes(8).toString('hex');
      const userCreateResponse = await axios.post(`${STRAPI_URL}/api/users`, {
        email: userEmail,
        username: payload.name_first || userEmail,
        password: randomPassword,
        role: '' // Ensure 'role' is included as an empty string
      }, {
        headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
      });
      userId = userCreateResponse.data.id;

      // Create UserProfile for new user
      console.log('Creating UserProfile for new user');
      const userProfileCreateResponse = await axios.post(`${STRAPI_URL}/api/user-profiles`, {
        data: {
          amountDonated: amount,
          totalPoints: totalPoints,
          user: userId,
          token: token,
          billingDate: token ? billingDateStr : undefined
        }
      }, {
        headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
      });
      userProfileId = userProfileCreateResponse.data.data.id;

      // Create new Donation
      const donationCreateResponse = await axios.post(`${STRAPI_URL}/api/donations`, {
        data: {
          amount: amount,
          donationDate: billingDateStr || new Date().toLocaleDateString('en-GB'),
          userProfile: userProfileId,
          biome: biomeId // This should be set below after finding/creating biome
        }
      }, {
        headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
      });

      // Create GiftDonation if applicable
      if (friendName && friendEmail) {
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
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
      }

      // Handle Biome creation/update
      let biomeId;
      try {
        const biomeResponse = await axios.get(`${STRAPI_URL}/api/biomes`, {
          params: { filters: { name: { $eq: biomeName } } },
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        if (biomeResponse.data && biomeResponse.data.data && biomeResponse.data.data.length > 0) {
          biomeId = biomeResponse.data.data[0].id;
          await axios.put(`${STRAPI_URL}/api/biomes/${biomeId}`, {
            data: {
              totalDonated: (biomeResponse.data.data[0].attributes.totalDonated || 0) + amount
            }
          }, {
            headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
          });
        } else {
          console.error('Biome not found:', biomeName);
          return res.status(404).send('Biome not found');
        }
      } catch (error) {
        console.error('Error handling biome:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }

      // Handle CardsCollected
      try {
        const cardsResponse = await axios.get(`${STRAPI_URL}/api/cards`, {
          params: { filters: { pointsRequired: { $lte: totalPoints } } },
          headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        if (cardsResponse.data && cardsResponse.data.data && cardsResponse.data.data.length > 0) {
          for (const card of cardsResponse.data.data) {
            await axios.post(`${STRAPI_URL}/api/cards-collecteds`, {
              data: {
                card: card.id,
                user: userId // Directly associated with User
              }
            }, {
              headers: { 'Authorization': `Bearer ${STRAPI_API_TOKEN}`, 'Content-Type': 'application/json' }
            });
          }
        } else {
          console.error('No cards found for the given points');
          return res.status(404).send('No cards found for the given points');
        }
      } catch (error) {
        console.error('Error fetching or creating cards collected:', error.response ? error.response.data : error.message);
        return res.status(500).send('Internal Server Error');
      }
    }

    res.status(200).send('ITN processed successfully');
  } catch (error) {
    console.error('Error processing ITN:', error.response ? error.response.data : error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
