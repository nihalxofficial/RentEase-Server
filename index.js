const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const { Redis } = require("@upstash/redis");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const port = process.env.PORT;
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ==================== UPSTASH REDIS ====================

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Default TTLs (seconds)
const TTL = {
  PROPERTIES_LIST: 60,
  PROPERTY_SINGLE: 300,
  REVIEWS: 120,
  WISHLIST: 60,
  USERS: 120,
  TRANSACTIONS: 60,
  BOOKINGS: 60,
};

// List-style caches are "versioned" — bumping the version key instantly
// invalidates every previously cached list key without a wildcard scan/delete
// (which the Upstash REST API doesn't support cheaply).
const getVersion = async (name) => {
  const v = await redis.get(`ver:${name}`);
  return v || 1;
};

const bumpVersion = async (name) => {
  try {
    await redis.incr(`ver:${name}`);
  } catch (err) {
    console.error(`Redis bumpVersion(${name}) failed:`, err.message);
  }
};

const cacheGet = async (key) => {
  try {
    const cached = await redis.get(key);
    return cached ?? null;
  } catch (err) {
    console.error(`Redis GET (${key}) failed:`, err.message);
    return null;
  }
};

const cacheSet = async (key, value, ttlSeconds) => {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.error(`Redis SET (${key}) failed:`, err.message);
  }
};

const cacheDel = async (...keys) => {
  try {
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    console.error(`Redis DEL (${keys.join(",")}) failed:`, err.message);
  }
};

const verifyToken = async (req, res, next) => {
  const { authorization } = req.headers;
  const token = authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthenticated" });
  }
  try {
    const JWKS = createRemoteJWKSet(
      new URL(process.env.CLIENT_URL + "/api/auth/jwks"),
    );
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    // console.log(payload);
    next();
  } catch (error) {
    console.error("Token validation failed:", error);
    return res.status(401).json({ message: "Unauthenticated" });
  }
};

const verifyOwner = async (req, res, next) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({ message: "Unauthorized" });
  }
  next();
};
const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }
  next();
};
const verifyTenant = async (req, res, next) => {
  if (req.user.role !== "tenant") {
    return res.status(403).json({ message: "Unauthorized" });
  }
  next();
};

async function run() {
  try {
    const db = await client.db("rentease_db");
    const propertyCollection = db.collection("properties");
    const reviewCollection = db.collection("reviews");
    const userCollection = db.collection("user");
    const wishlistCollection = db.collection("wishlist");
    const transactionCollection = db.collection("transactions");
    const bookingCollection = db.collection("bookings");

    // Property Related apis
    // app.get("/api/properties", async (req, res) => {
    //   const query = {};

    //   if (req.query.search) {
    //     query.$or = [
    //       { title: { $regex: req.query.search, $options: "i" } },
    //       { location: { $regex: req.query.search, $options: "i" } },
    //       { extraFeatures: { $regex: req.query.search, $options: "i" } },
    //     ];
    //   }

    //   if (req.query.propertyType) {
    //     query.propertyType = req.query.propertyType;
    //   }
    //   if (req.query.status) {
    //     query.status = req.query.status;
    //   }

    //   const sortOption =
    //     req.query.sortBy === "low-to-high"
    //       ? { price: 1 }
    //       : req.query.sortBy === "high-to-low"
    //         ? { price: -1 }
    //         : {};

    //   const total = await propertyCollection.countDocuments(query);

    //   const page = parseInt(req.query.page) || 1;
    //   const perPage = parseInt(req.query.perPage) || 6;
    //   const skipItems = (page - 1) * perPage;

    //   const properties = await propertyCollection
    //     .find(query)
    //     .sort(sortOption)
    //     .skip(skipItems)
    //     .limit(perPage)
    //     .toArray();

    //   res.send({ properties, total });
    // });

    // Properties retrieve with aggregate
    app.get("/api/properties", async (req, res) => {
      const version = await getVersion("properties");
      const cacheKey = `properties:v${version}:${JSON.stringify(req.query)}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const query = {};

      if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
      }

      if (req.query.isFeatured) {
        const isFeatured = req.query.isFeatured === "true";
        query.isFeatured = isFeatured;
      }

      if (req.query.search) {
        query.$or = [
          { title: { $regex: req.query.search, $options: "i" } },
          { location: { $regex: req.query.search, $options: "i" } },
          { extraFeatures: { $regex: req.query.search, $options: "i" } },
        ];
      }

      if (req.query.propertyType) {
        query.propertyType = req.query.propertyType;
      }
      if (req.query.status) {
        query.status = req.query.status;
      }

      if (req.query.location) {
        query.location = { $regex: req.query.location, $options: "i" };
      }

      if (req.query.minPrice || req.query.maxPrice) {
        query.price = {};
        if (req.query.minPrice)
          query.price.$gte = parseFloat(req.query.minPrice);
        if (req.query.maxPrice)
          query.price.$lte = parseFloat(req.query.maxPrice);
      }

      const sortOption =
        req.query.sortBy === "low-to-high"
          ? { price: 1 }
          : req.query.sortBy === "high-to-low"
            ? { price: -1 }
            : { createdAt: -1 };

      const total = await propertyCollection.countDocuments(query);

      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.perPage) || 6;
      const skipItems = (page - 1) * perPage;

      const properties = await propertyCollection
        .aggregate([
          { $match: query },
          { $sort: sortOption },
          { $skip: skipItems },
          { $limit: perPage },

          // Step 1: Convert ObjectId to string (since propertyId in reviews is string)
          {
            $addFields: {
              propertyIdString: { $toString: "$_id" },
            },
          },

          // Step 2: Lookup using the string version
          {
            $lookup: {
              from: "reviews",
              localField: "propertyIdString", // This is now a string
              foreignField: "propertyId", // This is also a string
              as: "reviews",
            },
          },

          // Calculate rating and review count
          {
            $addFields: {
              reviewCount: { $size: "$reviews" },
              rating: {
                $cond: [
                  { $gt: [{ $size: "$reviews" }, 0] },
                  { $round: [{ $avg: "$reviews.rating" }, 1] },
                  0,
                ],
              },
            },
          },

          // Remove temporary fields and reviews array
          {
            $project: {
              propertyIdString: 0,
              reviews: 0,
            },
          },
        ])
        .toArray();

      const responseBody = { properties, total };

      await cacheSet(cacheKey, responseBody, TTL.PROPERTIES_LIST);

      res.send(responseBody);
    });

    app.get("/api/properties/:id", async (req, res) => {
      const { id } = req.params;
      const cacheKey = `property:${id}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const property = await propertyCollection.findOne({
        _id: new ObjectId(id),
      });

      if (property) {
        await cacheSet(cacheKey, property, TTL.PROPERTY_SINGLE);
      }

      res.send(property);
    });

    app.post("/api/properties", verifyToken, verifyOwner, async (req, res) => {
      const property = req.body;
      const result = await propertyCollection.insertOne({
        ...property,
        isFeatured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await bumpVersion("properties");

      res.send(result);
    });

    app.patch("/api/properties/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const property = req.body;
      const result = await propertyCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: property },
      );

      await bumpVersion("properties");
      await cacheDel(`property:${id}`);

      res.send(result);
    });

    app.delete("/api/properties/:id", async (req, res) => {
      const { id } = req.params;
      const result = await propertyCollection.deleteOne({
        _id: new ObjectId(id),
      });

      await bumpVersion("properties");
      await cacheDel(`property:${id}`);

      res.send(result);
    });

    // Reviews related apis ====================

    app.get("/api/reviews", async (req, res) => {
      const version = await getVersion("reviews");
      const cacheKey = `reviews:v${version}:${JSON.stringify(req.query)}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const query = {};

      if (req.query.propertyId) {
        query.propertyId = req.query.propertyId;
      }

      const reviews = await reviewCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $addFields: {
              tenantObjectId: {
                $toObjectId: "$tenantId",
              },
            },
          },
          {
            $lookup: {
              from: "user",
              localField: "tenantObjectId",
              foreignField: "_id",
              as: "tenant",
            },
          },
          {
            $unwind: "$tenant",
          },
          {
            $project: {
              tenantObjectId: 0,
            },
          },
        ])
        .toArray();

      await cacheSet(cacheKey, reviews, TTL.REVIEWS);

      res.send(reviews);
    });

    // app.get("/api/reviews/:id", async (req, res) => {
    //   const { id } = req.params;
    //   const review = await reviewCollection.findOne({
    //     _id: new ObjectId(id),
    //   });
    //   res.send(review);
    // });

    app.post("/api/reviews", verifyToken, verifyTenant, async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne({
        ...review,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await bumpVersion("reviews");
      await bumpVersion("properties"); // rating/reviewCount shown on property lists
      if (review.propertyId) await cacheDel(`property:${review.propertyId}`);

      res.send(result);
    });

    app.patch("/api/reviews/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const review = req.body;
      const result = await reviewCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: review },
      );

      await bumpVersion("reviews");
      await bumpVersion("properties");

      res.send(result);
    });
    app.delete("/api/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const result = await reviewCollection.deleteOne({
        _id: new ObjectId(id),
      });

      await bumpVersion("reviews");
      await bumpVersion("properties");

      res.send(result);
    });

    // WishList related apis ===================
    app.get("/api/wishlist", async (req, res) => {
      const version = await getVersion("wishlist");
      const cacheKey = `wishlist:v${version}:${JSON.stringify(req.query)}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const query = {};
      if (req.query.tenantId) {
        query.tenantId = req.query.tenantId;
      }
      const wishlist = await wishlistCollection.find(query).toArray();

      await cacheSet(cacheKey, wishlist, TTL.WISHLIST);

      res.send(wishlist);
    });

    app.get("/api/wishlist/check", async (req, res) => {
      const { propertyId, tenantId } = req.query;
      const cacheKey = `wishlist:check:${propertyId}:${tenantId}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const wishlist = await wishlistCollection.findOne({
        propertyId,
        tenantId,
      });

      const responseBody = {
        success: true,
        isWishlisted: !!wishlist,
      };

      await cacheSet(cacheKey, responseBody, TTL.WISHLIST);

      res.send(responseBody);
    });

    app.post("/api/wishlist", verifyToken, verifyTenant, async (req, res) => {
      const wish = req.body;
      const result = await wishlistCollection.insertOne({
        ...wish,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await bumpVersion("wishlist");
      await cacheDel(`wishlist:check:${wish.propertyId}:${wish.tenantId}`);

      res.send(result);
    });

    app.delete("/api/wishlist", async (req, res) => {
      const { propertyId, tenantId } = req.query;

      const result = await wishlistCollection.deleteOne({
        propertyId,
        tenantId,
      });

      await bumpVersion("wishlist");
      await cacheDel(`wishlist:check:${propertyId}:${tenantId}`);

      res.send(result);
    });

    // User related apis ============================
    app.get("/api/users", async (req, res) => {
      const cacheKey = "users:all";

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const users = await userCollection.find().toArray();

      await cacheSet(cacheKey, users, TTL.USERS);

      res.send(users);
    });

    app.get("/api/users/:id", async (req, res) => {
      const { id } =  req.params;
      const cacheKey = `user:${id}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const user = await userCollection.findOne({ _id: new ObjectId(id) });

      if (user) {
        await cacheSet(cacheKey, user, TTL.USERS);
      }

      res.send(user);
    });

    app.patch("/api/users/:id", async (req, res) => {
      const { id } = req.params;
      const data =  req.body;
      const result = await userCollection.updateOne({ _id: new ObjectId(id)}, {$set: data});

      await cacheDel(`user:${id}`, "users:all");

      res.send(result);
    });



    // Transaction related apis =========================
    app.get("/api/transactions", async (req, res) => {
      const version = await getVersion("transactions");
      const cacheKey = `transactions:v${version}:${JSON.stringify(req.query)}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const query = {};
      if (req.query.userId) {
        query.userId = req.query.userId;
      }
      if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
      }
      if (req.query.bookingId) {
        query.bookingId = req.query.bookingId;
      }
      const transactions = await transactionCollection.find(query).toArray();

      await cacheSet(cacheKey, transactions, TTL.TRANSACTIONS);

      res.send(transactions);
    });

    // Booking related apis ==========================
    app.get("/api/bookings", async (req, res) => {
      const version = await getVersion("bookings");
      const cacheKey = `bookings:v${version}:${JSON.stringify(req.query)}`;

      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.send(cached);
      }

      const query = {};
      if (req.query.userId) {
        query.userId = req.query.userId;
      }
      if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
      }
      const bookings = await bookingCollection.find(query).toArray();

      await cacheSet(cacheKey, bookings, TTL.BOOKINGS);

      res.send(bookings);
    });

    app.post("/api/bookings", async (req, res) => {
      const data = req.body;
      const { session_id } = data;

      const isBooked = await bookingCollection.findOne({ session_id });
      if (isBooked) {
        return res.send({ message: "Booking already exist" });
      }

      const result = await bookingCollection.insertOne({
        status: "pending",
        ...data,
        price: Number(data.price),
        createdAt: new Date(),
      });

      await transactionCollection.insertOne({
        bookingId: result.insertedId.toString(),
        propertyId: data.propertyId,
        userId: data.userId,
        ownerId: data.ownerId,
        amount: Number(data.price),
        currency: "usd",
        session_id: data.session_id,
        status: "completed",
        createdAt: new Date(),
      });

      await bumpVersion("bookings");
      await bumpVersion("transactions");

      res.send({ message: "Payment successful✅" });
    });

    app.patch("/api/bookings/:id", async (req, res) => {
      const { id } = req.params;
      const data = req.body;

      // Convert to ObjectId
      const bookingId = new ObjectId(id);

      // If approving, reject other pending bookings for same property
      if (data.status === "approved") {
        // Get the booking to find its propertyId
        const booking = await bookingCollection.findOne({ _id: bookingId });

        if (booking) {
          // Reject all other pending bookings for this property
          await bookingCollection.updateMany(
            {
              propertyId: booking.propertyId,
              status: "pending",
              _id: { $ne: bookingId },
            },
            {
              $set: {
                status: "rejected",
                rejectionReason: "Another booking was approved",
              },
            },
          );
        }
      }

      // Update the current booking
      const result = await bookingCollection.updateOne(
        { _id: bookingId },
        { $set: data },
      );

      await bumpVersion("bookings");

      res.send(result);
    });

    
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send({ message: "Server is Active✅" });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

module.exports = app;