const express = require("express");
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");
const cors = require("cors");
const app = express();

// Allow specific origin

const corsOptions = {
  origin: "*", // Allow the frontend domain
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
  ],
  credentials: true, // Allow credentials (cookies, authorization headers)
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly (this part is actually redundant if you use the CORS middleware above)
// But it's fine to handle it explicitly if needed
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true");
  return res.sendStatus(204); // No content for preflight
});

app.use(express.json({ limit: "50mb" }));

// Logging the incoming request
app.use((req, res, next) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  console.log("Request headers:", req.headers);
  // If you want to log the body too (for POST/PUT requests), you could add:
  console.log("Request body:", req.body); // Be cautious about logging sensitive data
  next();
});

// Logging the outgoing response
app.use((req, res, next) => {
  // Capture the original `send` function
  const originalSend = res.send;

  res.send = function (body) {
    console.log("Response status:", res.statusCode);
    console.log("Response body:", body); // Be cautious about logging sensitive data
    originalSend.apply(res, arguments); // Send the response as usual
  };

  next();
});

// Initialize Firebase Admin SDK with service account key
const serviceAccount = require("./firebase-service-account-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();
const storage = new Storage();
const bucketName = "socialmapp-images-firebase";
const bucket = storage.bucket(bucketName);

// Middleware to verify Firebase ID token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const idToken = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Helper function to get user's nickname
async function getUserNickname(userId) {
  const userDoc = await firestore.collection("users").doc(userId).get();
  return userDoc.exists ? userDoc.data().nickname : null;
}

// Helper function to get user's display name (nickname or email)
async function getUserDisplayName(userId, email) {
  const nickname = await getUserNickname(userId);
  return nickname || email;
}

// API to submit a post (requires authentication)
app.post("/api/posts", authenticateToken, async (req, res) => {
  const { username, text, imageBase64 } = req.body;

  // Validate required fields
  if (!text) {
    return res.status(400).json({ error: "Text content is required" });
  }

  console.log("Received imageBase64:", imageBase64); // Debug log

  try {
    // Verify the username matches the authenticated user
    const firebaseUser = await admin.auth().getUser(req.user.uid);
    if (firebaseUser.email !== username) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    let imageUrl = null;
    // Only process image if imageBase64 is provided and valid
    if (imageBase64) {
      if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
        return res.status(400).json({ error: "Invalid image data" });
      }
      // Save image to Cloud Storage
      const imageFileName = `${username}-${Date.now()}.png`;
      const file = bucket.file(imageFileName);
      const buffer = Buffer.from(imageBase64, "base64");
      await file.save(buffer, { contentType: "image/png" });

      // Get the public URL of the image
      imageUrl = `https://storage.googleapis.com/${bucketName}/${imageFileName}`;
    }

    // Save post to Firestore
    const postRef = await firestore.collection("posts").add({
      username,
      text,
      imageUrl,
      createdAt: new Date().toISOString(),
      userId: req.user.uid,
    });

    res.status(201).json({
      id: postRef.id,
      text,
      ...(imageUrl && { imageUrl }),
    });
  } catch (error) {
    console.error("Error in /api/posts:", error); // Debug log
    res.status(500).json({ error: error.message });
  }
});

// API to get all posts (public or authenticated)
app.get("/api/posts", authenticateToken, async (req, res) => {
  try {
    const postsSnapshot = await firestore.collection("posts").get();
    const posts = [];

    // Get posts with like counts and display names
    for (const doc of postsSnapshot.docs) {
      const postData = doc.data();
      const [likesCount, displayName] = await Promise.all([
        getLikeCount(doc.id),
        getUserDisplayName(postData.userId, postData.username),
      ]);
      posts.push({
        id: doc.id,
        ...postData,
        displayName,
        likesCount,
      });
    }

    res.status(200).json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API to delete a post (requires authentication)
app.delete("/api/posts/:postId", authenticateToken, async (req, res) => {
  try {
    const postId = req.params.postId;
    // Get the post to verify ownership
    const postDoc = await firestore.collection("posts").doc(postId).get();

    if (!postDoc.exists) {
      return res.status(404).json({ error: "Post not found" });
    }

    const postData = postDoc.data();
    // Verify the post belongs to the authenticated user
    if (postData.userId !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this post" });
    }

    // Delete all related comments
    const commentsSnapshot = await firestore
      .collection("comments")
      .where("postId", "==", postId)
      .get();

    const commentDeletions = commentsSnapshot.docs.map((doc) =>
      firestore.collection("comments").doc(doc.id).delete()
    );

    // Delete all related likes
    const likesSnapshot = await firestore
      .collection("likes")
      .where("postId", "==", postId)
      .get();

    const likeDeletions = likesSnapshot.docs.map((doc) =>
      firestore.collection("likes").doc(doc.id).delete()
    );

    // If post has an image, delete it from Cloud Storage
    if (postData.imageUrl) {
      const imageFileName = postData.imageUrl.split("/").pop();
      try {
        await bucket.file(imageFileName).delete();
      } catch (error) {
        console.error("Error deleting image:", error);
        // Continue with post deletion even if image deletion fails
      }
    }

    // Execute all deletions in parallel
    await Promise.all([
      ...commentDeletions,
      ...likeDeletions,
      firestore.collection("posts").doc(postId).delete(),
    ]);

    res.status(200).json({
      message: "Post and all related data deleted successfully",
      deletedComments: commentsSnapshot.size,
      deletedLikes: likesSnapshot.size,
    });
  } catch (error) {
    console.error("Error in delete post:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to add a comment to a post (requires authentication)
app.post("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Comment text is required" });
    }

    // Verify the post exists
    const postDoc = await firestore.collection("posts").doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Get user information
    const firebaseUser = await admin.auth().getUser(req.user.uid);

    // Create the comment
    const commentRef = await firestore.collection("comments").add({
      postId,
      text,
      username: firebaseUser.email,
      userId: req.user.uid,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      id: commentRef.id,
      text,
      username: firebaseUser.email,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in adding comment:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to get comments for a post
app.get("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;

    // Verify the post exists
    const postDoc = await firestore.collection("posts").doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Get all comments for the post
    const commentsSnapshot = await firestore
      .collection("comments")
      .where("postId", "==", postId)
      .orderBy("createdAt", "desc")
      .get();

    // Get display names for all comments
    const comments = await Promise.all(
      commentsSnapshot.docs.map(async (doc) => {
        const commentData = doc.data();
        const displayName = await getUserDisplayName(
          commentData.userId,
          commentData.username
        );
        return {
          id: doc.id,
          ...commentData,
          displayName,
        };
      })
    );

    res.status(200).json(comments);
  } catch (error) {
    console.error("Error in fetching comments:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to delete a comment (requires authentication)
app.delete("/api/comments/:commentId", authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;

    // Get the comment to verify ownership
    const commentDoc = await firestore
      .collection("comments")
      .doc(commentId)
      .get();
    if (!commentDoc.exists) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const commentData = commentDoc.data();
    // Verify the comment belongs to the authenticated user
    if (commentData.userId !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this comment" });
    }

    // Delete the comment
    await firestore.collection("comments").doc(commentId).delete();
    res.status(200).json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Error in delete comment:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to like a post
app.post("/api/posts/:postId/like", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;

    // Check if post exists
    const postDoc = await firestore.collection("posts").doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Check if user already liked the post
    const likeQuery = await firestore
      .collection("likes")
      .where("postId", "==", postId)
      .where("userId", "==", userId)
      .get();

    if (!likeQuery.empty) {
      return res.status(400).json({ error: "Post already liked" });
    }

    // Add like to likes collection
    await firestore.collection("likes").add({
      postId,
      userId,
      createdAt: new Date().toISOString(),
    });

    // Get updated like count
    const likesCount = await getLikeCount(postId);

    res.status(201).json({
      message: "Post liked successfully",
      likesCount,
    });
  } catch (error) {
    console.error("Error in liking post:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to unlike a post
app.delete("/api/posts/:postId/like", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;

    // Find and delete the like
    const likeQuery = await firestore
      .collection("likes")
      .where("postId", "==", postId)
      .where("userId", "==", userId)
      .get();

    if (likeQuery.empty) {
      return res.status(404).json({ error: "Like not found" });
    }

    // Delete the like document
    await firestore.collection("likes").doc(likeQuery.docs[0].id).delete();

    // Get updated like count
    const likesCount = await getLikeCount(postId);

    res.status(200).json({
      message: "Post unliked successfully",
      likesCount,
    });
  } catch (error) {
    console.error("Error in unliking post:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to get like status and count for a post
app.get("/api/posts/:postId/likes", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;

    // Check if user liked the post
    const likeQuery = await firestore
      .collection("likes")
      .where("postId", "==", postId)
      .where("userId", "==", userId)
      .get();

    const hasLiked = !likeQuery.empty;
    const likesCount = await getLikeCount(postId);

    res.status(200).json({ hasLiked, likesCount });
  } catch (error) {
    console.error("Error in getting likes:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get like count for a post
async function getLikeCount(postId) {
  const likesQuery = await firestore
    .collection("likes")
    .where("postId", "==", postId)
    .get();
  return likesQuery.size;
}

// API to set or update user nickname
app.post("/api/user/nickname", authenticateToken, async (req, res) => {
  try {
    const { nickname } = req.body;
    const userId = req.user.uid;

    if (!nickname || nickname.trim().length === 0) {
      return res.status(400).json({ error: "Nickname is required" });
    }

    // Update or create user profile
    await firestore.collection("users").doc(userId).set(
      {
        nickname: nickname.trim(),
        email: req.user.email,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({
      message: "Nickname updated successfully",
      nickname,
    });
  } catch (error) {
    console.error("Error updating nickname:", error);
    res.status(500).json({ error: error.message });
  }
});

// API to get user profile
app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userDoc = await firestore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.json({ email: req.user.email });
    }

    res.json(userDoc.data());
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/test", (req, res) => {
  res.status(200).json({ message: "Test route working!" });
});

const PORT = 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Database server running on port ${PORT}`);
});
