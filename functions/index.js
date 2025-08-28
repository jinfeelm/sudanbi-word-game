const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.isNicknameAvailable = functions.https.onCall(async (data, context) => {
  const nickname = data.nickname;

  if (!nickname || nickname.length < 2 || nickname.length > 10) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "닉네임은 2~10자 사이여야 합니다."
    );
  }

  const scoresRef = db.collection("scores");
  const snapshot = await scoresRef.where("name", "==", nickname).limit(1).get();

  if (snapshot.empty) {
    return {isAvailable: true};
  } else {
    return {isAvailable: false};
  }
});

exports.getKakaoKey = functions.https.onCall((data, context) => {
  const kakaoKey = functions.config().kakao.key;
  return { key: kakaoKey };
});