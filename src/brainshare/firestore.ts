// Firestore Web namespaced API

import firebase from 'firebase/compat/app';

import "firebase/compat/firestore";



const firebaseConfig = {

  apiKey: "AIzaSyD5SfW2WPSzPg-HNASixEeTAyjc32fBesA",

  authDomain: "mineral-bonus-333017.firebaseapp.com",

  projectId: "mineral-bonus-333017",

  storageBucket: "mineral-bonus-333017.appspot.com",

  messagingSenderId: "411980762826",

  appId: "1:411980762826:web:7bf8bbbde9c0bffcfd2e33",

  measurementId: "G-WPCEMF7Z07"

};



// Initialize Firebase

firebase.initializeApp(firebaseConfig);

firebase.firestore().settings({

  ignoreUndefinedProperties: true,

})

// Initialize Cloud Firestore and get a reference to the service

export const db = firebase.firestore();
