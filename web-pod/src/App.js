import React, { useState, useEffect } from "react";
import { auth } from "./firebase";
import {
	signInWithEmailAndPassword,
	createUserWithEmailAndPassword,
	signOut,
} from "firebase/auth";
import axios from "axios";
import "./App.css";

// Helper function to format dates
const formatDate = (dateString) => {
	const date = new Date(dateString);
	return date.toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const App = () => {
	const [user, setUser] = useState(null);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [text, setText] = useState("");
	const [image, setImage] = useState(null);
	const [posts, setPosts] = useState([]);
	const [comments, setComments] = useState({});
	const [newComments, setNewComments] = useState({});
	const [postLikes, setPostLikes] = useState({});
	const [nickname, setNickname] = useState("");
	const [isEditingNickname, setIsEditingNickname] = useState(false);

	const API_URL = "https://socialm.duckdns.org";

	// Handle Firebase auth state
	useEffect(() => {
		const unsubscribe = auth.onAuthStateChanged((user) => {
			if (user) {
				setUser(user);
				fetchPosts();
				fetchUserProfile();
			} else {
				setUser(null);
				setPosts([]);
				setNickname("");
			}
		});
		return unsubscribe;
	}, []);

	// Fetch user profile
	const fetchUserProfile = async () => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			const response = await axios.get(`${API_URL}/api/user/profile`, {
				headers: { Authorization: `Bearer ${idToken}` },
				withCredentials: true,
			});
			setNickname(response.data.nickname || "");
		} catch (error) {
			console.error("Error fetching user profile:", error);
		}
	};

	// Handle nickname update
	const handleUpdateNickname = async () => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			await axios.post(
				`${API_URL}/api/user/nickname`,
				{ nickname },
				{ headers: { Authorization: `Bearer ${idToken}` } },
				{ withCredentials: true }
			);
			setIsEditingNickname(false);
			fetchPosts(); // Refresh posts to show new nickname
		} catch (error) {
			alert(
				"Error updating nickname: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	// Fetch posts
	const fetchPosts = async () => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			const response = await axios.get(`${API_URL}/api/posts`, {
				headers: { Authorization: `Bearer ${idToken}` },
				withCredentials: true,
			});
			// Sort posts by createdAt in descending order (newest first)
			const sortedPosts = response.data.sort(
				(a, b) => new Date(b.createdAt) - new Date(a.createdAt)
			);
			setPosts(sortedPosts);
			// Fetch comments and likes for each post
			sortedPosts.forEach((post) => {
				fetchComments(post.id);
				fetchLikeStatus(post.id);
			});
		} catch (error) {
			console.error("Error fetching posts:", error);
		}
	};

	// Fetch comments for a post
	const fetchComments = async (postId) => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			const response = await axios.get(
				`${API_URL}/api/posts/${postId}/comments`,
				{
					headers: { Authorization: `Bearer ${idToken}` },
					withCredentials: true,
				}
			);
			setComments((prev) => ({
				...prev,
				[postId]: response.data,
			}));
		} catch (error) {
			console.error("Error fetching comments:", error);
		}
	};

	// Fetch like status for a post
	const fetchLikeStatus = async (postId) => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			const response = await axios.get(
				`${API_URL}/api/posts/${postId}/likes`,
				{
					headers: { Authorization: `Bearer ${idToken}` },
					withCredentials: true,
				}
			);
			setPostLikes((prev) => ({
				...prev,
				[postId]: response.data,
			}));
		} catch (error) {
			console.error("Error fetching like status:", error);
		}
	};

	// Handle registration
	const handleRegister = async () => {
		try {
			await createUserWithEmailAndPassword(auth, email, password);
			alert("Registration successful! You can use our Social App now.");
		} catch (error) {
			alert("Error registering: " + error.message);
		}
	};

	// Handle login
	const handleLogin = async () => {
		try {
			await signInWithEmailAndPassword(auth, email, password);
		} catch (error) {
			alert("Error logging in: " + error.message);
		}
	};

	// Handle post submission
	const handleSubmitPost = async () => {
		if (!text) {
			alert("Please provide text for your post.");
			return;
		}

		try {
			const idToken = await auth.currentUser.getIdToken();
			const postData = { username: user.email, text, imageBase64: null };

			if (image) {
				const reader = new FileReader();
				reader.readAsDataURL(image);
				reader.onload = async () => {
					const imageBase64 = reader.result.split(",")[1];
					postData.imageBase64 = imageBase64;
					await submitPost(idToken, postData);
				};
			} else {
				await submitPost(idToken, postData);
			}
		} catch (error) {
			alert(
				"Error submitting post: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	const submitPost = async (idToken, postData) => {
		await axios.post(`${API_URL}/api/posts`, postData, {
			headers: { Authorization: `Bearer ${idToken}` },
			withCredentials: true,
		});
		setText("");
		setImage(null);
		fetchPosts();
	};

	// Handle post deletion
	const handleDeletePost = async (postId) => {
		// Ask for confirmation before deleting
		const confirmDelete = window.confirm(
			"Are you sure you want to delete this post?"
		);
		if (!confirmDelete) return;

		try {
			const idToken = await auth.currentUser.getIdToken();
			await axios.delete(`${API_URL}/api/posts/${postId}`, {
				headers: { Authorization: `Bearer ${idToken}` },
				withCredentials: true,
			});
			fetchPosts();
		} catch (error) {
			alert(
				"Error deleting post: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	// Handle comment submission
	const handleSubmitComment = async (postId) => {
		const commentText = newComments[postId] || "";
		if (!commentText.trim()) {
			alert("Please write a comment first.");
			return;
		}

		try {
			const idToken = await auth.currentUser.getIdToken();
			await axios.post(
				`${API_URL}/api/posts/${postId}/comments`,
				{ text: commentText },
				{ headers: { Authorization: `Bearer ${idToken}` }, withCredentials: true }
			);
			setNewComments((prev) => ({
				...prev,
				[postId]: "",
			}));
			fetchComments(postId);
		} catch (error) {
			alert(
				"Error submitting comment: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	// Handle comment deletion
	const handleDeleteComment = async (commentId) => {
		// Ask for confirmation before deleting
		const confirmDelete = window.confirm(
			"Are you sure you want to delete this comment?"
		);
		if (!confirmDelete) return;

		try {
			const idToken = await auth.currentUser.getIdToken();
			await axios.delete(`${API_URL}/api/comments/${commentId}`, {
				headers: { Authorization: `Bearer ${idToken}` },
				withCredentials: true,
			});
			// Refresh comments for all posts
			posts.forEach((post) => fetchComments(post.id));
		} catch (error) {
			alert(
				"Error deleting comment: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	// Handle liking/unliking a post
	const handleLikeToggle = async (postId) => {
		try {
			const idToken = await auth.currentUser.getIdToken();
			const isLiked = postLikes[postId]?.hasLiked;

			if (isLiked) {
				await axios.delete(`${API_URL}/api/posts/${postId}/like`, {
					headers: { Authorization: `Bearer ${idToken}` },
					withCredentials: true,
				});
			} else {
				await axios.post(
					`${API_URL}/api/posts/${postId}/like`,
					{},
					{
						headers: { Authorization: `Bearer ${idToken}` },
					}
				);
			}

			// Update like status for the post
			fetchLikeStatus(postId);
		} catch (error) {
			alert(
				"Error toggling like: " + error.response?.data?.error ||
					error.message
			);
		}
	};

	// Handle logout
	const handleLogout = async () => {
		try {
			await signOut(auth);
		} catch (error) {
			console.error("Error logging out:", error);
		}
	};

	if (!user) {
		return (
			<div className="App">
				<h1>Social Media App</h1>
				<h2>Register</h2>
				<input
					type="email"
					placeholder="Email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
				<input
					type="password"
					placeholder="Password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
				<button onClick={handleRegister}>Register</button>

				<h2>Login</h2>
				<button onClick={handleLogin}>Login</button>
			</div>
		);
	}

	return (
		<div className="App">
			<div className="user-header">
				<h1>Hello! Welcome, {nickname || user.email}!</h1>
				<div className="nickname-section">
					{isEditingNickname ? (
						<div className="nickname-edit">
							<input
								type="text"
								value={nickname}
								onChange={(e) => setNickname(e.target.value)}
								placeholder="Enter nickname"
							/>
							<button
								onClick={handleUpdateNickname}
								className="save-button"
							>
								Save
							</button>
							<button
								onClick={() => setIsEditingNickname(false)}
								className="cancel-button"
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							onClick={() => setIsEditingNickname(true)}
							className="edit-button"
						>
							{nickname ? "Change Nickname" : "Set Nickname"}
						</button>
					)}
				</div>
				<button onClick={handleLogout}>Logout</button>
			</div>

			<h2>Create a Post</h2>
			<textarea
				placeholder="Write your post..."
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<input
				type="file"
				accept="image/*"
				onChange={(e) => setImage(e.target.files[0])}
			/>
			<button onClick={handleSubmitPost}>Submit Post</button>

			<h2>Posts</h2>
			{posts.map((post) => (
				<div key={post.id} className="post">
					<div className="post-header">
						<strong>{post.displayName}</strong>
						<span className="timestamp">
							{formatDate(post.createdAt)}
						</span>
					</div>
					<p className="post-content">{post.text}</p>
					{post.imageUrl && (
						<img
							src={post.imageUrl}
							alt="Post"
							style={{ maxWidth: "300px" }}
						/>
					)}
					<div className="post-actions">
						<button
							onClick={() => handleLikeToggle(post.id)}
							className={`like-button ${
								postLikes[post.id]?.hasLiked ? "liked" : ""
							}`}
						>
							{postLikes[post.id]?.hasLiked ? "❤️ " : "🤍 "}
							{postLikes[post.id]?.likesCount || 0}{" "}
							{postLikes[post.id]?.likesCount === 1
								? "like"
								: "likes"}
						</button>
						{post.username === user.email && (
							<button
								onClick={() => handleDeletePost(post.id)}
								className="delete-button"
							>
								Delete
							</button>
						)}
					</div>

					{/* Comments section */}
					<div className="comments-section">
						<h4>Comments</h4>
						<div className="add-comment">
							<input
								type="text"
								placeholder="Write a comment..."
								value={newComments[post.id] || ""}
								onChange={(e) =>
									setNewComments((prev) => ({
										...prev,
										[post.id]: e.target.value,
									}))
								}
							/>
							<button
								onClick={() => handleSubmitComment(post.id)}
							>
								Add Comment
							</button>
						</div>
						<div className="comments-list">
							{comments[post.id]?.map((comment) => (
								<div key={comment.id} className="comment">
									<div className="comment-content">
										<div className="comment-header">
											<strong>
												{comment.displayName}
											</strong>
											<span className="timestamp">
												{formatDate(comment.createdAt)}
											</span>
										</div>
										<p>{comment.text}</p>
									</div>
									{comment.username === user.email && (
										<button
											onClick={() =>
												handleDeleteComment(comment.id)
											}
											className="delete-button"
										>
											Delete
										</button>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			))}
		</div>
	);
};

export default App;
