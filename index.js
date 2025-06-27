const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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

    const usersCollection = client.db("parcelDB").collection("users")
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentsCollection = client.db("parcelDB").collection("payments");

    // users 
    app.post('/users', async(req, res) =>{
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email })
      
      if(userExists) return res.status(200).send({message: "user already exists", inserted: false})

        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result)
    })

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

    app.get("/payments", async (req, res) => {
      const email = req.query.email;

      if (!email) return res.status(400).send({ error: "Email is required" });

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
