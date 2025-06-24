"use client"; // Add this line at the very top of the file

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, onSnapshot, serverTimestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { getAnalytics, logEvent } from 'firebase/analytics'; // Import Analytics SDK

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Default Firebase configuration for local development.
// IMPORTANT: Replace these placeholder values with your actual Firebase project configuration
// when running the app locally outside of the Canvas environment.
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDeJgR3UB4pTp6HChBytGlrdc1ej1kV7kc",
  authDomain: "steinman-tennis.firebaseapp.com",
  projectId: "steinman-tennis",
  storageBucket: "steinman-tennis.firebasestorage.app",
  messagingSenderId: "590586540046",
  appId: "1:590586540046:web:264ab89a69bc11ed314c5f",
  measurementId: "G-5M5NKM84SE" // Make sure this is present for Analytics
};

// Determine Firebase configuration to use: prioritize Canvas globals, else use default.
let firebaseConfig = { ...defaultFirebaseConfig };
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
        const canvasConfig = JSON.parse(__firebase_config);
        // Merge canvas config over defaults, allowing Canvas to override local settings
        firebaseConfig = { ...firebaseConfig, ...canvasConfig };
    } catch (e) {
        console.error("Error parsing __firebase_config from Canvas, using default:", e);
    }
}

// Explicitly set appId from __app_id if it's provided by Canvas, as it might be more precise.
const resolvedAppId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.appId;
if (resolvedAppId) {
    firebaseConfig.appId = resolvedAppId;
}

// Determine Gemini API Key: prioritize Canvas global if present, else default empty string
// Changed default to empty string as per instructions for Canvas environment.
const geminiApiKey = typeof __api_key !== 'undefined' ? __api_key : 'AIzaSyCCjpPj4Nz8b24xrYN69Fc36SLhJZc2dDg';
