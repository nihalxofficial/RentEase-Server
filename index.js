const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require("dotenv");
const cors = require("cors")
dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

const port = process.env.PORT
const uri = process.env.MONGO_URI


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    const db = await client.db("rentease_db");
    const propertyCollection = db.collection("properties");

    app.get("/api/properties", async(req,res)=> {
        const properties = await propertyCollection.find().toArray();
        res.send(properties);
    })

    app.get("/api/properties/:id", async(req,res)=> {
        const {id} = req.params;
        const property = await propertyCollection.findOne({_id: new ObjectId(id)})
        res.send(property);
    })

    app.post("/api/properties", async(req,res)=> {
        const property = req.body;
        const result = await propertyCollection.insertOne(property);
        res.send(result);
    })
    app.patch("/api/properties/:id", async(req,res)=> {
        const {id} = req.params;
        const property = req.body;
        const result = await propertyCollection.updateOne({_id: new ObjectId(id)}, {$set: property})
        res.send(result);
    })
    app.delete("/api/properties", async(req,res)=> {
        const properties = await propertyCollection.find().toArray();
        res.send(properties);
    })
  } finally {
    ;
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send({message: "Server is Active✅"})
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})