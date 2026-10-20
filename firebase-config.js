// Firebase web app configuration is public client config.
// Do not put service account credentials or private keys in this file.
export const firebaseConfig = {
  apiKey: "AIzaSyAZFp9JEEj8HfkLYUTFkmNCd0gY7JmRIjg",
  authDomain: "pasyalphadmin.firebaseapp.com",
  databaseURL:
    "https://pasyalphadmin-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pasyalphadmin",
  storageBucket: "pasyalphadmin.firebasestorage.app",
  messagingSenderId: "165997589226",
  appId: "1:165997589226:web:a3007ea04ec8b6cf155d93",
  measurementId: "G-709N4TLWZQ",
};

// Update these paths to match the mobile app's Realtime Database JSON tree.
export const PATHS = {
  restaurants: "restaurants",
  stays: "airbnbListings",
  comments: "comments",
  reports: "reports",
  users: "users",
};
