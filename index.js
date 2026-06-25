const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.PORT;
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

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
    const wishlistCollection = db.collection("wishlist")

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
      const query = {};

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

      res.send({ properties, total });
    });

    app.get("/api/properties/:id", async (req, res) => {
      const { id } = req.params;
      const property = await propertyCollection.findOne({
        _id: new ObjectId(id),
      });
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
      res.send(result);
    });

    app.patch("/api/properties/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const property = req.body;
      const result = await propertyCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: property },
      );
      res.send(result);
    });
    app.delete("/api/properties/:id", async (req, res) => {
      const { id } = req.params;
      const result = await propertyCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Reviews related apis ====================

    app.get("/api/reviews", async (req, res) => {
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
      res.send(result);
    });

    app.patch("/api/reviews/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const review = req.body;
      const result = await reviewCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: review },
      );
      res.send(result);
    });
    app.delete("/api/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const result = await reviewCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // WishList related apis ===================
    app.get("/api/wishlist", async (req, res) => {
      const query = {}
      if(req.query.tenantId){
        query.tenantId = req.query.tenantId
      }
      const wishlist = await wishlistCollection.find(query).toArray();
      res.send(wishlist);
    });

    app.post("/api/wishlist", verifyToken, verifyTenant, async (req, res) => {
      const wish = req.body;
      const result = await wishlistCollection.insertOne({
        ...wish,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      res.send(result);
    });

    app.patch("/api/wishlist/:id", verifyToken, verifyTenant, async (req, res) => {
      const { id } = req.params;
      const wish = req.body;
      const result = await reviewCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: wish },
      );
      res.send(result);
    });

    app.delete("/api/wishlist/:id", async (req, res) => {
      const { id } = req.params;
      const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // User related apis ========================
    app.get("/api/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send({ message: "Server is Active✅" });
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
