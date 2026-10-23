/** The few Firebase SDK functions the log upload uses (SPEC "Firebase log upload"). firebase.ts imports this file
 *  lazily; importing named functions statically here lets the bundler drop the rest of the SDK. */
export { initializeApp, setLogLevel } from 'firebase/app';
export { initializeAuth, browserLocalPersistence, signInAnonymously } from 'firebase/auth';
export { initializeFirestore, setDoc, doc, serverTimestamp } from 'firebase/firestore/lite';
