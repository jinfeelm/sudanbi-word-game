const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * 닉네임 중복 여부를 확인하는 함수
 */
exports.isNicknameAvailable = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const nickname = request.data.nickname?.trim();
    if (!nickname || nickname.length < 2 || nickname.length > 10) {
        throw new HttpsError("invalid-argument", "닉네임은 2~10자 사이여야 합니다.");
    }
    const snapshot = await db.collection("scores").where("name", "==", nickname).limit(1).get();
    return { isAvailable: snapshot.empty };
});

/**
 * 카카오 공유 기능을 위한 JavaScript 키를 반환하는 함수
 */
exports.getKakaoKey = onCall({ region: "asia-northeast3", secrets: ["KAKAO_KEY"], cors: true }, (request) => {
    const kakaoKey = process.env.KAKAO_KEY;
    if (!kakaoKey) {
        console.error("KAKAO_KEY secret is not set.");
        throw new HttpsError("not-found", "카카오 키가 설정되지 않았습니다. 관리자에게 문의하세요.");
    }
    return { key: kakaoKey };
});

/**
 * 사용자의 오늘 도전 가능 여부를 확인하는 함수
 */
exports.checkAttempts = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const attemptDocRef = db.collection("attempts").doc(uid);
    const attemptDoc = await attemptDocRef.get();

    if (!attemptDoc.exists) {
        return { canPlay: true, reason: "First play of the day." };
    }

    const data = attemptDoc.data();
    const playCount = data.count || 0;
    const lastPlayDate = data.date;
    const hasShared = data.hasSharedToday || false;

    if (lastPlayDate !== todayStr) {
        return { canPlay: true, reason: "New day." };
    }
    
    if (playCount === 0) {
        return { canPlay: true, reason: "First play of the day." };
    }
    
    if (playCount === 1 && hasShared) {
        return { canPlay: true, reason: "Has an extra chance from sharing." };
    }

    if (playCount >= 1 && !hasShared) {
        return { canPlay: false, reason: "Share to get another chance." };
    }

    return { canPlay: false, reason: "All chances used for today." };
});


/**
 * 사용자의 도전 횟수를 기록하는 함수
 */
exports.recordAttempt = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "인증된 사용자만 접근할 수 있습니다.");
    }

    const today = new Date().toISOString().split("T")[0];
    const attemptDocRef = db.collection("attempts").doc(uid);

    try {
        await db.runTransaction(async (transaction) => {
            const attemptDoc = await transaction.get(attemptDocRef);
            
            if (!attemptDoc.exists || attemptDoc.data().date !== today) {
                transaction.set(attemptDocRef, {
                    uid: uid,
                    date: today,
                    count: 1,
                    hasSharedToday: false,
                });
            } else {
                const newCount = (attemptDoc.data().count || 0) + 1;
                transaction.update(attemptDocRef, { count: newCount });
            }
        });
        return { success: true };
    } catch (error) {
        console.error("Error recording attempt:", error);
        throw new HttpsError("internal", "도전 횟수를 기록하는 중 오류가 발생했습니다.");
    }
});
