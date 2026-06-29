import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPGs2QshC2DFYEQ06ZIqiM2w3ZdTC_myA",
  authDomain: "wc26-predictor-b4e8d.firebaseapp.com",
  projectId: "wc26-predictor-b4e8d",
  storageBucket: "wc26-predictor-b4e8d.firebasestorage.app",
  messagingSenderId: "585226339324",
  appId: "1:585226339324:web:76051bdf821ed6492ae879",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
