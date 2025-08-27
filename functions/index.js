const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.isNicknameAvailable = functions.https.onCall(async (data, context) => {
  const nickname = data.nickname;

  if (!nickname || nickname.length > 10) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "닉네임은 1~10자 사이여야 합니다.",
    );
  }

  const nicknameDoc = await db.collection("nicknames").doc(nickname).get();

  if (!nicknameDoc.exists) {
    return {isAvailable: true};
  } else {
    return {isAvailable: false};
  }
});