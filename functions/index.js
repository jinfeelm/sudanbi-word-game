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
    
    // playCount가 1일 때, 공유를 했다면 한 번 더 플레이 가능
    if (playCount === 1 && hasShared) {
        return { canPlay: true, reason: "Has an extra chance from sharing." };
    }
    
    // playCount가 2 이상이거나, 1인데 공유를 안했다면 플레이 불가
    if (playCount >= 2) {
         return { canPlay: false, reason: "All chances used for today." };
    }
    
    if (playCount >= 1 && !hasShared) {
        return { canPlay: false, reason: "Share to get another chance." };
    }

    // 기본적으로는 플레이 불가
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

/**
 * 사용자가 오늘 공유했음을 기록하여 추가 기회를 부여하는 함수
 */
exports.markSharedToday = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const today = new Date().toISOString().split("T")[0];
    const attemptDocRef = db.collection("attempts").doc(uid);

    try {
        const result = await db.runTransaction(async (transaction) => {
            const attemptDoc = await transaction.get(attemptDocRef);

            if (!attemptDoc.exists || attemptDoc.data().date !== today) {
                transaction.set(attemptDocRef, {
                    uid: uid,
                    date: today,
                    count: 0,
                    hasSharedToday: true,
                });
                return { alreadyShared: false, resetForToday: true };
            }

            if (attemptDoc.data().hasSharedToday) {
                return { alreadyShared: true, resetForToday: false };
            }

            transaction.update(attemptDocRef, { hasSharedToday: true });
            return { alreadyShared: false, resetForToday: false };
        });

        return { success: true, ...result };
    } catch (error) {
        console.error("Error marking share:", error);
        throw new HttpsError("internal", "공유 정보를 저장하는 중 오류가 발생했습니다.");
    }
});

/**
 * 사용자의 주차별 점수를 기록하고 총점을 업데이트하는 함수
 */
exports.updateScore = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const { score, elapsedTime, week, nickname } = request.data;
    if (typeof score !== 'number' || typeof elapsedTime !== 'number' || !week || !nickname) {
        throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    const userRef = db.collection("users").doc(uid);
    const weekKey = `week${week}`;

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                // 새 사용자인 경우 문서 생성
                const initialScores = {};
                for (let i = 1; i <= 4; i++) {
                    initialScores[`week${i}`] = { score: 0, elapsedTime: 0 };
                }
                initialScores[weekKey] = { score, elapsedTime };

                transaction.set(userRef, {
                    uid: uid,
                    name: nickname,
                    totalScore: score,
                    weeklyScores: initialScores,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // 기존 사용자인 경우 점수 업데이트
                const data = userDoc.data();
                const currentWeeklyScores = data.weeklyScores || {};
                const oldWeekScore = currentWeeklyScores[weekKey]?.score || 0;

                // 새 점수가 해당 주차의 최고 점수인 경우에만 업데이트
                if (score > oldWeekScore) {
                    currentWeeklyScores[weekKey] = { score, elapsedTime };

                    // totalScore 다시 계산
                    const newTotalScore = Object.values(currentWeeklyScores).reduce((sum, s) => sum + s.score, 0);

                    transaction.update(userRef, {
                        weeklyScores: currentWeeklyScores,
                        totalScore: newTotalScore,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        });
        return { success: true, message: "점수가 성공적으로 기록되었습니다." };
    } catch (error) {
        console.error("Error updating score:", error);
        throw new HttpsError("internal", "점수 기록 중 오류가 발생했습니다.");
    }
});

/**
 * 주간 랭킹을 가져오는 함수
 */
exports.getWeeklyLeaderboard = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const { week } = request.data;
    if (!week) {
        throw new HttpsError("invalid-argument", "주차 정보가 필요합니다.");
    }
    const weekKey = `weeklyScores.week${week}`;

    const snapshot = await db.collection("users")
        .orderBy(`${weekKey}.score`, "desc")
        .orderBy(`${weekKey}.elapsedTime`, "asc")
        .limit(10)
        .get();

    const leaderboard = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            name: data.name,
            score: data.weeklyScores[`week${week}`]?.score || 0,
            elapsedTime: data.weeklyScores[`week${week}`]?.elapsedTime || 0,
        };
    });
    return { leaderboard };
});

/**
 * 누적 랭킹을 가져오는 함수
 */
exports.getTotalLeaderboard = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const snapshot = await db.collection("users")
        .orderBy("totalScore", "desc")
        .limit(10)
        .get();

    const leaderboard = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            name: data.name,
            score: data.totalScore
            // 누적 랭킹에서는 elapsedTime을 표시하지 않거나, 다른 기준을 적용할 수 있습니다.
        };
    });
    return { leaderboard };
});