const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
    // 🚑 FIX: 'scores'가 아닌 'users' 컬렉션을 보도록 수정
    const snapshot = await db.collection("users").where("name", "==", nickname).limit(1).get();
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
    
    if (playCount >= 2) {
         return { canPlay: false, reason: "All chances used for today." };
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
                const data = userDoc.data();
                const currentWeeklyScores = data.weeklyScores || {};
                const oldWeekScore = currentWeeklyScores[weekKey]?.score || 0;

                if (score > oldWeekScore) {
                    currentWeeklyScores[weekKey] = { score, elapsedTime };
                    
                    // 🚑 FIX: 예상치 못한 데이터(null 등)가 있어도 오류가 나지 않도록 안정성 강화
                    const newTotalScore = Object.values(currentWeeklyScores).reduce((sum, s) => sum + (s?.score || 0), 0);

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
 * 5분마다 랭킹 데이터를 집계하여 캐시 문서를 생성하는 스케줄링 함수
 */
exports.updateLeaderboardsOnSchedule = onSchedule({
    schedule: "every 5 minutes",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
}, async (event) => {
    console.log("Running scheduled leaderboard update...");
    const leaderboardRef = db.collection("leaderboards").doc("summary");

    try {
        const totalSnapshot = await db.collection("users")
            .orderBy("totalScore", "desc")
            .limit(10)
            .get();
        const totalLeaderboard = totalSnapshot.docs.map(doc => ({
            name: doc.data().name,
            score: doc.data().totalScore,
        }));

        const weeklyLeaderboards = {};
        for (let week = 1; week <= 4; week++) {
            const weekKey = `weeklyScores.week${week}`;
            const weeklySnapshot = await db.collection("users")
                .orderBy(`${weekKey}.score`, "desc")
                .orderBy(`${weekKey}.elapsedTime`, "asc")
                .limit(10)
                .get();
            weeklyLeaderboards[`week${week}`] = weeklySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    name: data.name,
                    score: data.weeklyScores[`week${week}`]?.score || 0,
                    elapsedTime: data.weeklyScores[`week${week}`]?.elapsedTime || 0,
                };
            });
        }
        
        await leaderboardRef.set({
            total: totalLeaderboard,
            weekly: weeklyLeaderboards,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log("Successfully updated leaderboards.");
        return null;

    } catch (error) {
        console.error("Error updating leaderboards:", error);
        return null;
    }
});
