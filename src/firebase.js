import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyAjSPl6zriFH23m5vFqPXLUPxiMYCxbvd0",
  authDomain: "rohans-mentality.firebaseapp.com",
  databaseURL: "https://rohans-mentality-default-rtdb.firebaseio.com",
  projectId: "rohans-mentality",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
