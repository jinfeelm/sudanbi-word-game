/**
 * 2026 수단비 윈터스쿨 (Season 2) Cloud Functions
 * 수정: Secret Manager 제거 버전 (무료 플랜 호환용)
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ❄️ 시즌 2 설정
const SEASON_ID = "season2"; 
const COL_USERS = `users_${SEASON_ID}`;             
const COL_ATTEMPTS = `attempts_${SEASON_ID}`;       
const COL_LEADERBOARDS = `leaderboards_${SEASON_ID}`; 

// 🔥 [중요] 여기에 카카오 JavaScript 키를 직접 입력하세요!
// 예: const KAKAO_JS_KEY = "a1b2c3d4e5..."; 
const KAKAO_JS_KEY = "3b220ecf82039d6604c6a42308e4dd1a";

/**
 * 1. 닉네임 중복 확인
 */
exports.isNicknameAvailable = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const nickname = request.data.nickname?.trim();
    if (!nickname || nickname.length < 2 || nickname.length > 10) {
        throw new HttpsError("invalid-argument", "닉네임은 2~10자 사이여야 합니다.");
    }
    const snapshot = await db.collection(COL_USERS).where("name", "==", nickname).limit(1).get();
    return { isAvailable: snapshot.empty };
});

/**
 * 2. 카카오 API 키 조회 (수정됨)
 * Secret Manager를 쓰지 않고 변수에서 바로 반환합니다.
 */
exports.getKakaoKey = onCall({ region: "asia-northeast3", cors: true }, (request) => {
    // 키가 설정되지 않았을 경우를 대비한 안전 장치
    if (!KAKAO_JS_KEY || KAKAO_JS_KEY.includes("여기에")) {
        console.warn("카카오 키가 설정되지 않았습니다.");
        return { key: "" }; 
    }
    return { key: KAKAO_JS_KEY };
});

/**
 * 3. 오늘 도전 가능 여부 확인
 */
exports.checkAttempts = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const todayStr = new Date().toISOString().split("T")[0];
    const attemptDoc = await db.collection(COL_ATTEMPTS).doc(uid).get();

    if (!attemptDoc.exists) return { canPlay: true, reason: "First play" };

    const data = attemptDoc.data();
    if (data.date !== todayStr) return { canPlay: true, reason: "New day" };
    
    if (data.count < 1) return { canPlay: true };
    if (data.count === 1 && data.hasSharedToday) return { canPlay: true };
    if (data.count >= 1 && !data.hasSharedToday) return { canPlay: false, reason: "Share to get another chance." };

    return { canPlay: false, reason: "All chances used for today." };
});

/**
 * 4. 도전 시작 기록
 */
exports.recordAttempt = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "인증 필요");

    const today = new Date().toISOString().split("T")[0];
    const docRef = db.collection(COL_ATTEMPTS).doc(uid);

    await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists || doc.data().date !== today) {
            t.set(docRef, { uid, date: today, count: 1, hasSharedToday: false });
        } else {
            t.update(docRef, { count: (doc.data().count || 0) + 1 });
        }
    });
    return { success: true };
});

/**
 * 5. 점수 저장
 */
exports.updateScore = onCall({ region: "asia-northeast3", cors: true }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "인증 필요");

    const { score, elapsedTime, week, nickname } = request.data;

    // 점수 검증 (만점 600점 가정 시 여유있게 설정)
    if (score > 600) { 
        throw new HttpsError("invalid-argument", "비정상적인 점수입니다.");
    }

    const userRef = db.collection(COL_USERS).doc(uid);
    const weekKey = `week${week}`;

    await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        if (!doc.exists) {
            const initialScores = {};
            for (let i = 1; i <= 8; i++) initialScores[`week${i}`] = { score: 0, elapsedTime: 0 };
            initialScores[weekKey] = { score, elapsedTime };
            t.set(userRef, {
                uid, name: nickname, totalScore: score, weeklyScores: initialScores,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const data = doc.data();
            const currentWeekRecord = data.weeklyScores?.[weekKey] || { score: -1 };
            if (score > currentWeekRecord.score || (score === currentWeekRecord.score && elapsedTime < currentWeekRecord.elapsedTime)) {
                const newWeeklyScores = { ...data.weeklyScores, [weekKey]: { score, elapsedTime } };
                const newTotal = Object.values(newWeeklyScores).reduce((sum, s) => sum + (s?.score || 0), 0);
                t.update(userRef, {
                    weeklyScores: newWeeklyScores,
                    totalScore: newTotal,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }
    });
    return { success: true };
});

/**
 * 6. 랭킹 집계 스케줄러 (매 30분)
 */
exports.updateLeaderboardsOnSchedule = onSchedule({
    schedule: "every 30 minutes", 
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
}, async (event) => {
    const leaderboardRef = db.collection(COL_LEADERBOARDS).doc("summary");
    
    // Top 20 집계
    const totalSnap = await db.collection(COL_USERS).orderBy("totalScore", "desc").limit(20).get();
    const totalList = totalSnap.docs.map(d => ({ name: d.data().name, score: d.data().totalScore }));

    const weeklyList = {};
    for (let i = 1; i <= 8; i++) {
        const keyScore = `weeklyScores.week${i}.score`;
        const weekSnap = await db.collection(COL_USERS).orderBy(keyScore, "desc").limit(20).get();
        weeklyList[`week${i}`] = weekSnap.docs.map(d => ({
            name: d.data().name,
            score: d.data().weeklyScores[`week${i}`]?.score || 0,
            elapsedTime: d.data().weeklyScores[`week${i}`]?.elapsedTime || 0
        }));
    }

    await leaderboardRef.set({ 
        total: totalList, 
        weekly: weeklyList, 
        lastUpdated: admin.firestore.FieldValue.serverTimestamp() 
    });
    console.log("Leaderboard updated.");
});