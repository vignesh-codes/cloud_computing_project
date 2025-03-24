import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
	apiKey: "AIzaSyBXtRKYU-4NJryhiKEAuI9EahdWv5BEiiI",
	authDomain: "socialmapp-f1941.firebaseapp.com",
	projectId: "socialmapp-f1941",
	storageBucket: "socialmapp-f1941.firebasestorage.app",
	messagingSenderId: "667860939194",
	appId: "1:667860939194:web:56a5e2bbc2545affffed83",
	measurementId: "G-PDKKW2W4NT",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
