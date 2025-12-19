const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(express.json());
app.use(cors());

// use Credentials and Create mongoClient Connect
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@simple-crud-server.7fhuvu7.mongodb.net/?appName=simple-crud-server`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("local_chef_bazaar_db");
    const userCollection = db.collection("users");
    const roleRequestCollection = db.collection("roleRequests");
    const MealsCollection = db.collection("Meals");
    const ReviewsCollection = db.collection("reviews");

    // Users Related Api's
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        user.role = "user";
        user.createdAt = new Date();
        const email = user.email;

        const userExists = await userCollection.findOne({ email });
        if (userExists) {
          return res.status(409).json({ message: "User already exists" });
        }

        const result = await userCollection.insertOne(user);
        return res
          .status(201)
          .json({ message: "User created", insertedId: result.insertedId });
      } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;

      if (email) {
        const user = await userCollection.findOne({
          email: email.toLowerCase().trim(),
        });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        return res.send(user);
      }

      // admin: get all users
      const users = await userCollection
        .find({}, { sort: { createdAt: -1 } })
        .toArray();

      res.send(users);
    });

    // role wise users
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({
        role: user?.role || "user",
        status: user?.status || "active",
      });
    });

    // Update user status fraud
    app.patch("/users/fraud/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };

      const result = await userCollection.updateOne(query, {
        $set: { status: "fraud" },
      });

      res.send(result);
    });

    // request to change the role
    app.post("/role-requests", async (req, res) => {
      try {
        const request = req.body;

        // Check if a pending request already exists
        const existingRequest = await roleRequestCollection.findOne({
          userEmail: request.userEmail,
          requestStatus: "pending",
        });

        if (existingRequest) {
          return res.status(409).send({
            success: false,
            message: "You already have a pending role request",
          });
        }

        // Insert role request
        const result = await roleRequestCollection.insertOne(request);

        // Update user request info (NOT role)
        await userCollection.updateOne(
          { email: request.userEmail },
          {
            $set: {
              requestedRole: request.requestType,
              requestStatus: "pending",
            },
          }
        );

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // User: check status
    app.get("/role-requests", async (req, res) => {
      const { email } = req.query;

      if (email) {
        const result = await roleRequestCollection.findOne({
          userEmail: email,
          requestStatus: "pending",
        });
        return res.send(result);
      }

      const result = await roleRequestCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Admin: all requests
    app.get("/role-requests/all", async (req, res) => {
      const result = await roleRequestCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Admin: request status approve or reject
    app.patch("/role-requests/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { requestStatus } = req.body;

        if (!["approved", "rejected"].includes(requestStatus)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await roleRequestCollection.findOne({
          _id: new ObjectId(id),
        });

        await roleRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              requestStatus,
              updatedAt: new Date(),
            },
          }
        );

        if (requestStatus === "approved") {
          const updateDoc = {
            role: result.requestType,
            requestStatus: "approved",
          };

          if (result.requestType === "chef") {
            updateDoc.chefId = `CHEF-${Date.now()}`;
          }

          await userCollection.updateOne(
            { email: result.userEmail },
            {
              $set: updateDoc,
              $unset: {
                requestedRole: "",
              },
            }
          );
        }

        if (requestStatus === "rejected") {
          await userCollection.updateOne(
            { email: result.userEmail },
            {
              $set: {
                requestStatus: "rejected",
              },
              $unset: {
                requestedRole: "",
              },
            }
          );
        }

        res.send({
          success: true,
          message: `Request ${requestStatus} successfully`,
        });
      } catch (error) {
        console.error("Role request update error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Meals Related Api's
    app.post("/meals", async (req, res) => {
      try {
        const meal = req.body;

        // user is a chef or not
        const user = await userCollection.findOne({
          email: meal.userEmail,
          role: "chef",
          chefId: meal.chefId,
        });

        if (!user) {
          return res.status(403).send({
            success: false,
            message: "Only chefs can create meals",
          });
        }

        const newMeal = {
          foodName: meal.foodName,
          foodImage: meal.foodImage,
          chefName: user.displayName,
          chefId: user.chefId,
          userEmail: user.email,
          price: Number(meal.price),
          rating: Number(meal.rating || 0),
          ingredients: meal.ingredients,
          deliveryArea: meal.deliveryArea || [],
          estimatedDeliveryTime: meal.estimatedDeliveryTime || "",
          chefExperience: meal.chefExperience || "",
          createdAt: new Date(),
          status: "available",
        };

        const result = await MealsCollection.insertOne(newMeal);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Create meal error:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // Get meals by chef
    app.get("/meals", async (req, res) => {
      const { userEmail } = req.query;
      const query = userEmail ? { userEmail } : {};
      const meals = await MealsCollection.find(query).toArray();
      res.send(meals);
    });

    // Delete meal
    app.delete("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await MealsCollection.deleteOne(query);
      res.send(result);
    });

    // Update meal
    app.put("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      const result = await MealsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    // Get single meal by ID
    app.get("/meals/:id", async (req, res) => {
      try {
        const mealId = req.params.id;

        const meal = await MealsCollection.findOne({
          _id: new ObjectId(mealId),
        });

        res.send({ success: true, meal });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
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

app.get("/", (req, res) => {
  res.send("LocalChef Bazaar is running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
