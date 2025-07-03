const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zc7c13h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const usersCollection = client.db("parcelDB").collection("users");
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentsCollection = client.db("parcelDB").collection("payments");
    const ridersCollection = client.db("parcelDB").collection("riders");

    const verifyFireBaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader)
        return res.status(401).send({ message: "unauthorized access" });

      const token = authHeader.split(" ")[1];
      if (!token)
        return res.status(401).send({ message: "unauthorized access" });

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (err) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin")
        return res.status(403).send({ message: "forbidden access" });

      next();
    };

    // users
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists)
        return res
          .status(200)
          .send({ message: "user already exists", inserted: false });

      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user.role || "user" });
    });

    app.get("/users/search", async (req, res) => {
      const { email } = req.query;
      if (!email)
        return res.status(400).json({ message: "Email query is required" });

      const result = await usersCollection
        .find({ email: { $regex: email, $options: "i" } }) // case-insensitive partial match
        .project({ email: 1, created_at: 1, role: 1 }) // show only selected fields
        .limit(10)
        .toArray();

      res.send(result);
    });

    app.patch(
      "/user/:id/role",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        // Validate role
        if (!["admin", "user"].includes(role)) {
          return res
            .status(400)
            .json({ message: "Invalid role. Only 'admin' or 'user' allowed." });
        }

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );

          res.json({ message: `User role updated to '${role}'`, result });
        } catch (error) {
          res
            .status(500)
            .json({ message: "Server error", error: error.message });
        }
      }
    );

    // parcels
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;

      const cost = parcel.type === "document" ? 50 : 100;
      parcel.cost = cost;

      parcel.tracking_id = `TRK-${Date.now()}`;
      parcel.delivery_status = "not_collected";
      parcel.payment_status = "unpaid";
      parcel.creation_date = new Date().toISOString();

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const parcels = await parcelCollection.find().toArray();
      res.send(parcels);
    });

    app.get("/parcels", verifyFireBaseToken, async (req, res) => {
      const { userEmail, payment_status, delivery_status } = req.query;

      let query = {};

      if (userEmail) {
        query = { email: userEmail };
      }
      if (payment_status) {
        query.payment_status = payment_status;
      }
      if (delivery_status) {
        query.delivery_status = delivery_status;
      }
      // const query = userEmail ? { email: userEmail } : {};

      try {
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // Newest first
          .toArray();

        res.send(parcels);
      } catch (error) {
        console.error("Failed to fetch parcels:", error);
        res.status(500).send({ error: "Failed to fetch parcels." });
      }
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
      res.send(parcel);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const result = await parcelCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // riders
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.post("/riders/assign-rider", async (req, res) => {
      const { parcelId, riderId, riderEmail } = req.body;

      if (!parcelId || !riderId || !riderEmail) {
        return res
          .status(400)
          .send({ message: "Parcel ID, Rider ID, and Email are required" });
      }

      try {
        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              assignedRider: riderId,
              assignedRiderEmail: riderEmail, 
              delivery_status: "assigned",
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Parcel not found or not updated" });
        }

        res.send({ message: "Rider assigned successfully", result });
      } catch (err) {
        console.error("Failed to assign rider:", err);
        res
          .status(500)
          .send({ message: "Internal server error", error: err.message });
      }
    });

    app.get("/riders/available", async (req, res) => {
      const { district } = req.query;

      const riders = await ridersCollection
        .find({
          district: { $regex: `^${district}$`, $options: "i" },
        })
        .toArray();

      res.send(riders);
    });

    // GET all riders with status 'pending'
    app.get(
      "/riders/pending",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const pendingRiders = await ridersCollection
            .find({ status: "pending" })
            .toArray();
          res.send(pendingRiders);
        } catch (error) {
          console.error("Error fetching pending riders:", error);
          res.status(500).send({ message: "Internal server error" });
        }
      }
    );

    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      // update user role for accepting rider
      if (status === "approved") {
        const useQuery = { email };
        const userUpdatedDoc = {
          $set: { role: "rider" },
        };

        const roleResult = await usersCollection.updateOne(
          useQuery,
          userUpdatedDoc
        );
        console.log(roleResult.modifiedCount);
      }
      res.send(result);
    });

    // GET active riders
    app.get(
      "/riders/active",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        const result = await ridersCollection
          .find({ status: "approved" })
          .toArray();
        res.send(result);
      }
    );

    // tracking
    app.post("/tracking", async (req, res) => {
      const { trackingId, parcelId, status, location } = req.body;

      const newEntry = {
        trackingId,
        parcelId: new ObjectId(parcelId),
        status,
        location,
        time: new Date(),
      };

      const result = await trackingCollection.insertOne(newEntry);
      res.send(result);
    });

    // payments
    app.get("/payments", verifyFireBaseToken, async (req, res) => {
      const email = req.query.email;

      if (!email) return res.status(400).send({ error: "Email is required" });

      console.log("decoded ----------->", req.decoded);
      if (req.decoded.email !== email)
        return res.status(403).send({ message: "forbidden access" });

      try {
        const history = await paymentsCollection
          .find({ email })
          .sort({ paid_at: -1 }) // Latest first
          .toArray();

        res.send(history);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch payment history" });
      }
    });

    app.post("/payments", async (req, res) => {
      const { parcelId, email, amount, transactionId } = req.body;

      try {
        // Update parcel payment status
        const parcelResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: "paid" } }
        );

        // Insert payment record
        const paymentData = {
          parcelId: new ObjectId(parcelId),
          email,
          amount,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentData);

        res.send({
          insertedId: paymentResult.insertedId,
        });
      } catch (err) {
        console.error("Payment confirmation error:", err);
        res.status(500).send({ error: "Failed to confirm payment." });
      }
    });

    // credit card intent
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents, // amount in cents
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Basic Route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Start Server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
