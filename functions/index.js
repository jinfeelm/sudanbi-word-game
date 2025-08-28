// v2 SDK를 사용하도록 require 구문을 변경합니다.
const {onCall} = require("firebase-functions/v2/https");
const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * 닉네임 중복 여부를 확인하는 함수입니다. (v2 방식으로 수정)
 */
exports.isNicknameAvailable = onCall(
  // 함수 설정 객체에 직접 지역을 지정합니다.
  { region: "asia-northeast3" },
  async (request) => {
    // v2에서는 데이터가 request.data 안에 있습니다.
    const nickname = request.data.nickname;

    // 닉네임 유효성 검사
    if (!nickname || nickname.length < 2 || nickname.length > 10) {
      throw new HttpsError("invalid-argument", "닉네임은 2~10자 사이여야 합니다.");
    }

    // Firestore에서 닉네임 검색
    const scoresRef = db.collection("scores");
    const snapshot = await scoresRef.where("name", "==", nickname).limit(1).get();

    // 검색 결과에 따라 사용 가능 여부 반환
    if (snapshot.empty) {
      return { isAvailable: true };
    } else {
      return { isAvailable: false };
    }
  }
);

/**
 * 카카오 공유 기능을 위한 JavaScript 키를 반환하는 함수입니다. (v2 방식으로 수정)
 */
exports.getKakaoKey = onCall(
  { region: "asia-northeast3", secrets: ["KAKAO_KEY"] }, // secrets를 사용하면 더 안전하고 효율적입니다.
  (request) => {
    const kakaoKey = process.env.KAKAO_KEY;

    if (!kakaoKey) {
      console.error("KAKAO_KEY secret is not set.");
      throw new HttpsError(
        "not-found",
        "카카오 키가 설정되지 않았습니다. 관리자에게 문의하세요."
      );
    }
    
    return { key: kakaoKey };
  }
);