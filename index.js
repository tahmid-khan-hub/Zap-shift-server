const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

    const parcelCollection = client.db("parcelDB").collection("parcels");

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
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

    app.get("/parcels", async (req, res) => {
      const userEmail = req.query.email;

      const query = userEmail ? { email: userEmail } : {};

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
