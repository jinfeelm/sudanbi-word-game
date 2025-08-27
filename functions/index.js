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
  // 이 코드를 functions/index.js 파일 맨 아래에 추가하세요.
exports.getKakaoKey = functions.https.onCall((data, context) => {
  // Firebase 비밀 금고에 접근해서...
  const kakaoKey = functions.config().kakao.key;
  // ...보관해둔 카카오 키를 꺼내서 요청한 사람에게만 돌려줍니다.
  return { key: kakaoKey };
});
});