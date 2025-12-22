const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// stripe connection
const stripe = require("stripe")(process.env.STRIPE_SECRET);

// Middleware
app.use(express.json());
app.use(cors());

// use jwt token to verify user's
const verifyJWTToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }
    // put it in the right place
    // console.log("after decoded", decoded);
    req.token_email = decoded.email;

    next();
  });
};

// use Credentials and Create mongoClient Connect
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@simple-crud-server.7fhuvu7.mongodb.net/?appName=simple-crud-server`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Crate Random tracking id
const crypto = require("crypto");
function generateTrackingId() {
  const prefix = "LCB";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("local_chef_bazaar_db");
    const userCollection = db.collection("users");
    const roleRequestCollection = db.collection("roleRequests");
    const MealsCollection = db.collection("Meals");
    const ReviewsCollection = db.collection("reviews");
    const FavoritesCollection = db.collection("favorites");
    const OrdersCollection = db.collection("orders");
    const PaymentsCollection = db.collection("payments");
    const trackingsCollection = db.collection("trackings");

    // JWT related api
    app.post("/getToken", (req, res) => {
      const loggedUser = req.body;
      const token = jwt.sign(loggedUser, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token: token });
    });

    // tracking logged
    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split("_").join(" "),
        createdAt: new Date(),
      };
      const result = await trackingsCollection.insertOne(log);
      return result;
    };

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

    app.get("/users", verifyJWTToken, async (req, res) => {
      const { email } = req.query;
      const requesterEmail = req.token_email;
      // console.log(requesterEmail);

      try {
        if (email) {
          if (email !== requesterEmail) {
            return res.json({
              message: "Forbidden: Cannot access other users",
            });
          }

          const user = await userCollection.findOne({ email });

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }
          return res.send(user);
        }

        // admin: get all users
        const users = await userCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        return res.send(users);
      } catch (err) {
        console.error(err);
        return res.status(500).send({ message: "Server error" });
      }
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
    app.post("/meals", verifyJWTToken, async (req, res) => {
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
    app.get("/meals", verifyJWTToken, async (req, res) => {
      const { userEmail } = req.query;
      const requesterEmail = req.token_email;

      if (userEmail !== requesterEmail) {
        return res.json({
          message: "Forbidden: Cannot access other users",
        });
      }

      const query = userEmail ? { userEmail } : {};
      const meals = await MealsCollection.find(query).toArray();
      res.send(meals);
    });

    // for pagination
    app.get("/meals-paginated", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const sort = req.query.sort || "asc";
        const search = req.query.search || "";

        const skip = (page - 1) * limit;

        const query = search
          ? { foodName: { $regex: search, $options: "i" } }
          : {};

        const totalMeals = await MealsCollection.countDocuments(query);

        const meals = await MealsCollection.find(query)
          .skip(skip)
          .limit(limit)
          .sort({ price: sort === "asc" ? 1 : -1 })
          .toArray();

        res.send({
          meals,
          totalMeals,
          totalPages: Math.ceil(totalMeals / limit),
          currentPage: page,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch meals" });
      }
    });

    // home page meals api
    app.get("/meals/home", async (req, res) => {
      const meals = await MealsCollection.find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(meals);
    });

    // Delete meal
    app.delete("/meals/:id", verifyJWTToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await MealsCollection.deleteOne(query);
      res.send(result);
    });

    // Update meal
    app.put("/meals/:id", verifyJWTToken, async (req, res) => {
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

    // Review Related Api's
    app.get("/reviews/home", async (req, res) => {
      try {
        const reviews = await ReviewsCollection.aggregate([
          { $match: { rating: { $gte: 4 } } },
          { $sample: { size: 4 } },
        ]).toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({
          message: "Failed to load home reviews",
        });
      }
    });

    //user wise Review
    app.get("/my-reviews", async (req, res) => {
      try {
        const { email } = req.query;

        const reviews = await ReviewsCollection.aggregate([
          { $match: { userEmail: email.toLowerCase().trim() } },
          {
            $addFields: {
              foodObjectId: {
                $cond: [
                  { $eq: [{ $type: "$foodId" }, "string"] },
                  { $toObjectId: "$foodId" },
                  "$foodId",
                ],
              },
            },
          },

          {
            $lookup: {
              from: "Meals",
              localField: "foodObjectId",
              foreignField: "_id",
              as: "meal",
            },
          },

          { $unwind: { path: "$meal", preserveNullAndEmptyArrays: true } },

          {
            $project: {
              rating: 1,
              comment: 1,
              date: 1,
              mealName: { $ifNull: ["$meal.foodName", "Meal Deleted"] },
            },
          },

          { $sort: { date: -1 } },
        ]).toArray();

        res.send(reviews);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load reviews" });
      }
    });

    //Update Review
    app.patch("/reviews/:id", async (req, res) => {
      const { rating, comment } = req.body;

      const result = await ReviewsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            rating: Number(rating),
            comment,
            date: new Date(),
          },
        }
      );

      res.send({ success: result.modifiedCount > 0 });
    });

    // delete review
    app.delete("/reviews/:id", async (req, res) => {
      const result = await ReviewsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send({ success: result.deletedCount > 0 });
    });

    // Add Review for a meal
    app.post("/meals/:mealId/review", async (req, res) => {
      try {
        const { mealId } = req.params;
        const { userEmail, reviewerName, reviewerImage, rating, comment } =
          req.body;

        // Check user reviewed exist
        const existingReview = await ReviewsCollection.findOne({
          foodId: mealId,
          userEmail,
        });

        if (existingReview) {
          return res.status(400).send({
            success: false,
            message: "You have already reviewed this meal",
          });
        }

        const newReview = {
          foodId: mealId,
          userEmail,
          reviewerName,
          reviewerImage,
          rating: Number(rating),
          comment,
          date: new Date(),
        };

        await ReviewsCollection.insertOne(newReview);

        res.send({
          success: true,
          message: "Review submitted successfully!",
          review: newReview,
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Get all reviews for a meal
    app.get("/meals/:mealId/reviews", async (req, res) => {
      try {
        const { mealId } = req.params;
        const reviews = await ReviewsCollection.find({ foodId: mealId })
          .sort({ date: -1 })
          .toArray();

        res.send({ success: true, reviews });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Favorites related api's
    app.post("/favorites", async (req, res) => {
      try {
        const { userEmail, mealId, mealName, chefId, chefName, price } =
          req.body;

        const existing = await FavoritesCollection.findOne({
          userEmail,
          mealId,
        });
        if (existing) {
          return res.status(400).send({
            success: false,
            message: "Meal already in favorites",
          });
        }

        const favorite = {
          userEmail,
          mealId,
          mealName,
          chefId,
          chefName,
          price,
          addedTime: new Date(),
        };

        await FavoritesCollection.insertOne(favorite);

        res.send({
          success: true,
          message: "Meal added to favorites!",
          favorite,
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Get favorites for logged-in user
    app.get("/favorites", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).send({ message: "Email required" });

        const favorites = await FavoritesCollection.aggregate([
          { $match: { userEmail: email.toLowerCase().trim() } },

          // Optional: populate meal info if needed
          {
            $lookup: {
              from: "meals",
              localField: "mealId",
              foreignField: "_id",
              as: "meal",
            },
          },
          { $unwind: { path: "$meal", preserveNullAndEmptyArrays: true } },

          {
            $project: {
              mealName: { $ifNull: ["$mealName", "$meal.foodName"] },
              chefName: 1,
              price: 1,
              addedTime: 1,
            },
          },

          { $sort: { addedTime: -1 } },
        ]).toArray();

        res.send(favorites);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load favorites" });
      }
    });

    // Delete favorite
    app.delete("/favorites/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await FavoritesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          return res.send({
            success: true,
            message: "Meal removed from favorites successfully.",
          });
        }

        res
          .status(404)
          .send({ success: false, message: "Favorite meal not found." });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to delete favorite." });
      }
    });

    // Order Related Api's
    app.post("/orders", async (req, res) => {
      const { userEmail } = req.body;

      const user = await userCollection.findOne({ email: userEmail });

      if (user?.status !== "active") {
        return res.status(403).send({
          success: false,
          message: "User account is not active",
        });
      }

      const trackingId = generateTrackingId();

      req.body.orderStatus = "pending";
      req.body.paymentStatus = "Pending";
      req.body.orderTime = new Date();
      req.body.trackingId = trackingId;

      const result = await OrdersCollection.insertOne(req.body);

      logTracking(trackingId, "order_pending");

      res.send({ success: true, result });
    });

    app.get("/orders", verifyJWTToken, async (req, res) => {
      try {
        const { email } = req.query;

        const orders = await OrdersCollection.aggregate([
          { $match: { userEmail: email.toLowerCase().trim() } },
          {
            $addFields: {
              foodObjectId: {
                $cond: [
                  { $eq: [{ $type: "$foodId" }, "string"] },
                  { $toObjectId: "$foodId" },
                  "$foodId",
                ],
              },
            },
          },
          {
            $lookup: {
              from: "Meals",
              localField: "foodObjectId",
              foreignField: "_id",
              as: "meal",
            },
          },
          {
            $unwind: {
              path: "$meal",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              foodName: "$meal.mealName",
              deliveryTime: "$meal.estimatedDeliveryTime",
              chefName: "$meal.chefName",
              chefId: "$meal.chefId",
              userEmail: 1,
              mealName: 1,
              price: 1,
              quantity: 1,
              orderStatus: 1,
              paymentStatus: 1,
              createdAt: 1,
            },
          },

          { $sort: { createdAt: -1 } },
        ]).toArray();

        res.send(orders);
      } catch {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // GET all orders
    app.get("/orders/all", async (req, res) => {
      try {
        const role = req.query.role;
        if (role !== "admin") {
          return res.status(403).send({ message: "forbidden" });
        }

        const orders = await OrdersCollection.find({}).toArray();
        res.send(orders);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // order-requests
    app.get("/chef/orders", async (req, res) => {
      try {
        const { chefId } = req.query;

        const orders = await OrdersCollection.find({ chefId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(orders);
      } catch {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    app.patch("/orders/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        const query = { _id: new ObjectId(id) };

        const order = await OrdersCollection.findOne(query);

        if (
          order.orderStatus === "cancelled" ||
          order.orderStatus === "delivered"
        ) {
          return res.send({ message: "Order cannot be updated" });
        }

        if (status === "accepted" && order.orderStatus !== "pending") {
          return res.send({ message: "Invalid transition" });
        }

        if (status === "delivered" && order.orderStatus !== "accepted") {
          return res.send({ message: "Order must be accepted first" });
        }

        await OrdersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { orderStatus: status } }
        );

        res.send({ message: "Order updated" });
      } catch (err) {
        // console.error(err);
        res.send({ message: "Update failed" });
      }
    });

    // payment related apis ( Stripe )
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const price = Number(paymentInfo.price);
        const quantity = Number(paymentInfo.quantity);
        const amount = Math.round(price * quantity * 100);

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: `Please pay for: ${paymentInfo.mealName}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            orderId: paymentInfo.orderId,
            mealName: paymentInfo.mealName,
          },
          customer_email: paymentInfo.customerEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/my-orders`,
        });

        // console.log("Stripe session created:", session);
        res.send({ url: session.url });
      } catch (err) {
        // console.error("Stripe error:", err);
        res.status(500).send({
          message: "Stripe session creation failed",
          error: err.message,
        });
      }
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        // Session id is avaiable or not
        if (!sessionId) {
          return res.send({ success: false, message: "No session ID" });
        }

        // Retrieve Stripe session
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        // console.log("session retrieve", session);

        if (!session || session.payment_status !== "paid") {
          return res.send({
            success: false,
            message: "Invalid or unpaid session",
          });
        }

        const transactionId = session.payment_intent;
        const orderId = session.metadata?.orderId;

        if (!transactionId || !orderId) {
          return res.send({ success: false, message: "Missing metadata" });
        }

        // Check  exists or not
        const existingPayment = await PaymentsCollection.findOne({
          transactionId,
        });

        if (existingPayment) {
          return res.send({
            success: true,
            message: "Payment already processed",
            paymentInfo: existingPayment,
          });
        }

        // payment status Check
        const order = await OrdersCollection.findOne({
          _id: new ObjectId(orderId),
        });

        if (order.paymentStatus === "paid") {
          return res.send({
            success: true,
            message: "Order already marked as paid",
          });
        }

        await OrdersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              paymentStatus: "paid",
              paidAt: new Date(),
            },
          }
        );

        const paymentData = {
          orderId,
          transactionId,
          mealName: session.metadata.mealName,
          customerEmail: session.customer_email,
          amount: session.amount_total / 100,
          currency: session.currency,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const paymentInserted = await PaymentsCollection.insertOne(paymentData);

        return res.send({
          success: true,
          message: "Payment processed successfully",
          paymentInfo: paymentInserted,
        });
      } catch (error) {
        // console.error("Payment success error:", error);
        return res.status(500).send({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    app.get("/payments", async (req, res) => {
      try {
        const { email, role } = req.query;

        let query = {};

        if (role === "admin") {
          query = {};
        } else {
          if (!email) {
            return res.status(400).send({ message: "Email required" });
          }
          query.customerEmail = email;
        }

        const payments = await PaymentsCollection.find(query)
          .sort({ paidAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
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
