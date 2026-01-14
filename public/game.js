// 🔥 [필수] 여기에 본인의 카카오 JavaScript 키를 붙여넣으세요!
const KAKAO_KEY = "3b220ecf82039d6604c6a42308e4dd1a"; 

// 📅 일정 설정 (자동 전환 시스템)
// 2026년 2월 2일 월요일 00:00:00에 정식 오픈 (그 전까지는 베타 모드)
const OFFICIAL_OPEN_DATE = new Date('2026-02-02T00:00:00+09:00'); 
const isBeta = new Date() < OFFICIAL_OPEN_DATE;

const CONFIG = {
    seasonId: 'season2', 
    // 베타 기간엔 'users_beta'에 저장, 정식 오픈(2/2)되면 'users_season2'로 자동 전환되어 초기화 효과
    userCol: isBeta ? 'users_beta' : 'users_season2',
    attemptCol: isBeta ? 'attempts_beta' : 'attempts_season2',
    emailCol: isBeta ? 'emails_beta' : 'emails_season2',
    startDate: '2026-02-02T00:00:00+09:00', // 정식 시즌 1주차 시작일
    maxTime: 60, initTime: 20, bonusTime: 1 // ⚡️ 난이도: 보너스 1초 유지
};

// 전역 변수
let db, auth;

let gameState = { score: 0, timeLeft: CONFIG.initTime, timerId: null, words: [], currentIndex: 0, nickname: localStorage.getItem('sudanbi_nickname') || '', week: 1, isPlayable: true };
let unsubscribeRanking = null; 
let isAppInitialized = false; 

// DOM Helper
const $ = (id) => document.getElementById(id);
const showScreen = (id) => { 
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    $(id).classList.add('active'); 
    
    if(id === 'screen-lobby') $('main-header').style.display = 'block';
    else $('main-header').style.display = 'none';
};

// 모달 로직
const showModal = (msg) => { 
    $('modal-msg').innerHTML = msg.replace(/\n/g, '<br>'); 
    const backdrop = $('modal-backdrop');
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => {
        backdrop.classList.remove('opacity-0');
        backdrop.querySelector('div').classList.remove('scale-95');
    });
};
window.closeModal = () => { 
    const backdrop = $('modal-backdrop');
    backdrop.classList.add('opacity-0');
    backdrop.querySelector('div').classList.add('scale-95');
    setTimeout(() => backdrop.classList.add('hidden'), 200); 
};

// --- 초기화 ---
async function initApp() {
    if (isAppInitialized) return; 
    isAppInitialized = true;
    
    db = firebase.firestore();
    auth = firebase.auth();

    showScreen('screen-lobby');

    if (window.Kakao && !Kakao.isInitialized()) {
        try { Kakao.init(KAKAO_KEY); } catch (e) { console.error("Kakao Init Fail:", e); }
    }

    initSeasonInfo();
    
    if (gameState.nickname) { 
        $('nickname-input').value = gameState.nickname; 
        $('nickname-input').disabled = true; 
        $('nickname-input').classList.add('text-slate-500', 'bg-slate-200'); 
    }
    
    loadLeaderboard('weekly');

    $('btn-start').onclick = tryStartGame;
    $('btn-share-revive').onclick = () => shareKakao(true);
    $('tab-weekly').onclick = () => loadLeaderboard('weekly');
    $('tab-total').onclick = () => loadLeaderboard('total');
    $('btn-submit-email').onclick = submitEmail;
    $('btn-share').onclick = () => shareKakao(false);
    $('btn-retry').onclick = () => location.reload();
}

function initSeasonInfo() {
    const start = new Date(CONFIG.startDate);
    const now = new Date();
    
    // 주차 계산 (시작일 기준 7일 단위)
    let week = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7)) + 1;
    
    // 베타 기간(시작일 이전)에는 week가 음수가 나오므로 1주차로 고정
    if (week < 1) week = 1; 
    
    // 🛑 중요: 4주 완성 코스로 변경 (4주차 이후는 계속 4주차로 유지)
    if (week > 4) week = 4;
    
    gameState.week = week;
    
    const weekStart = new Date(start); weekStart.setDate(start.getDate() + (week-1)*7);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    
    $('season-week').textContent = `WEEK ${week}`;
    
    // 베타 기간일 경우 날짜 표시를 "TEST MODE" 등으로 표시할 수도 있지만, 일단 계산된 날짜 유지
    $('season-date').textContent = `${weekStart.getMonth()+1}.${weekStart.getDate()} ~ ${weekEnd.getMonth()+1}.${weekEnd.getDate()}`;

    const banner = $('season-banner');
    if (isBeta) {
        // 베타 기간 문구 수정
        banner.textContent = "🚧 프리시즌(BETA) : 기록은 2/2 초기화";
        banner.className = "w-full text-center py-2 text-[10px] font-black tracking-widest uppercase bg-yellow-400 text-slate-900 shadow-sm";
    } else {
        banner.textContent = "🏆 수단비 단어 챌린지 S2";
        banner.className = "w-full text-center py-2 text-[10px] font-black tracking-widest uppercase bg-slate-900 text-white";
    }
}

// --- 게임 시작 로직 ---
async function tryStartGame() {
    const nickname = $('nickname-input').value.trim();
    if (nickname.length < 2) return showModal('닉네임을\n2자 이상 입력해주세요.');

    const btn = $('btn-start');
    const originalText = '<span class="relative z-10">GAME START</span>';
    
    btn.disabled = true; 
    btn.innerHTML = '<span class="animate-pulse">LOADING...</span>';

    try {
        if (!gameState.nickname) {
            const snap = await db.collection(CONFIG.userCol).where('name', '==', nickname).get();
            if (!snap.empty) throw new Error('이미 사용 중인 이름입니다.');
            localStorage.setItem('sudanbi_nickname', nickname);
            gameState.nickname = nickname;
        }

        const user = auth.currentUser;
        const today = new Date().toISOString().split("T")[0];
        const doc = await db.collection(CONFIG.attemptCol).doc(user.uid).get();
        let canPlay = true;

        if (doc.exists && doc.data().date === today) {
            const d = doc.data();
            
            if (d.count >= 2) { 
                canPlay = false; 
                btn.innerHTML = '<span class="relative z-10">내일 다시 도전!</span>';
                btn.disabled = true; 
                btn.classList.add('bg-slate-400', 'shadow-none', 'cursor-not-allowed'); 
                btn.classList.remove('hover:scale-[1.02]', 'active:scale-95', 'bg-blue-600', 'hover:bg-blue-500'); 
                
                showModal('오늘의 기회를 다 썼어요!\n내일 다시 도전하세요.'); 
                return; 
            }
            
            if (d.count >= 1 && !d.hasSharedToday) canPlay = false;

            if (!canPlay) {
                btn.classList.add('hidden');
                btn.disabled = false;
                btn.innerHTML = originalText;
                $('btn-share-revive').classList.remove('hidden');
                return showModal('기회 소진! 😱\n공유하면 한 번 더 할 수 있어요!');
            }
        }
        await loadWordsAndStart();
    } catch (e) {
        btn.disabled = false; 
        btn.innerHTML = originalText;
        showModal(e.message || '오류가 발생했습니다.');
    }
}

async function loadWordsAndStart() {
    const cacheKey = `${CONFIG.seasonId}_w${gameState.week}_v2`;
    let words = JSON.parse(localStorage.getItem(cacheKey));
    
    if (!words) {
        const doc = await db.collection('seasons').doc(CONFIG.seasonId).get();
        if (doc.exists) { 
            words = doc.data()[`Week ${gameState.week}`] || []; 
            if(words.length) localStorage.setItem(cacheKey, JSON.stringify(words));
        }
    }
    
    if (!words || !words.length) {
        $('btn-start').disabled = false; 
        $('btn-start').innerHTML = '<span class="relative z-10">GAME START</span>';
        return showModal('문제지를 불러오지 못했습니다.');
    }

    const user = auth.currentUser;
    const today = new Date().toISOString().split("T")[0];
    const attDoc = db.collection(CONFIG.attemptCol).doc(user.uid);
    await db.runTransaction(async t => {
        const doc = await t.get(attDoc);
        if (!doc.exists || doc.data().date !== today) t.set(attDoc, { uid: user.uid, date: today, count: 1, hasSharedToday: false });
        else t.update(attDoc, { count: (doc.data().count || 0) + 1 });
    });

    gameState.words = words.sort(() => Math.random() - 0.5);
    gameState.currentIndex = 0; gameState.score = 0; gameState.timeLeft = CONFIG.initTime; gameState.isPlayable = true;
    
    updateScoreUI();
    showScreen('screen-game');
    startGameLoop();
    renderQuestion();
}

function startGameLoop() {
    if (gameState.timerId) clearInterval(gameState.timerId);
    gameState.timerId = setInterval(() => {
        gameState.timeLeft -= 0.1;
        if (gameState.timeLeft <= 0.01) { gameState.timeLeft = 0; endGame(false); }
        updateTimerUI();
    }, 100);
}

function updateTimerUI() {
    const time = Math.ceil(gameState.timeLeft);
    $('timer-display').textContent = time;
    const pct = (gameState.timeLeft / CONFIG.initTime) * 100;
    const bar = $('time-bar');
    bar.style.width = `${Math.min(pct, 100)}%`;
    
    if (gameState.timeLeft < 5) { 
        bar.className = "h-full bg-red-500 transition-all duration-100 ease-linear rounded-full shadow-[0_0_10px_rgba(239,68,68,0.5)]";
        $('timer-display').classList.add('text-red-500'); 
    } else { 
        bar.className = "h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-100 ease-linear rounded-full shadow-[0_0_10px_rgba(37,99,235,0.3)]";
        $('timer-display').classList.remove('text-red-500'); 
    }
}
function updateScoreUI() { $('score-display').textContent = gameState.score; }

function renderQuestion() {
    if (gameState.currentIndex >= gameState.words.length) return endGame(true);
    
    const wordData = gameState.words[gameState.currentIndex];
    
    const wordEl = $('word-display');
    wordEl.classList.remove('animate-pop-in');
    void wordEl.offsetWidth; // trigger reflow
    wordEl.classList.add('animate-pop-in');
    wordEl.textContent = wordData['단어'];
    
    const badge = $('freq-badge');
    if (wordData['역대 기출'] && wordData['역대 기출'] !== "0") { 
        badge.textContent = `🔥 수능 기출 ${wordData['역대 기출']}회`; 
        badge.style.opacity = 1; 
        badge.style.transform = 'translateY(0)';
    } else {
        badge.style.opacity = 0;
        badge.style.transform = 'translateY(10px)';
    }

    const answers = [
        { text: wordData['정답'], isCorrect: true }, { text: wordData['오답1'], isCorrect: false },
        { text: wordData['오답2'], isCorrect: false }, { text: wordData['오답3'], isCorrect: false }
    ].sort(() => Math.random() - 0.5);

    const container = $('options-container'); container.innerHTML = '';
    answers.forEach(ans => {
        const btn = document.createElement('button');
        btn.className = 'option-btn w-full py-4 rounded-xl text-lg break-keep leading-snug px-3 text-slate-700 bg-white hover:bg-slate-50';
        btn.textContent = ans.text;
        btn.onclick = (e) => { 
            if(!gameState.isPlayable) return; 
            e.target.blur(); handleAnswer(btn, ans.isCorrect); 
        };
        container.appendChild(btn);
    });
}

function handleAnswer(btn, isCorrect) {
    gameState.isPlayable = false;
    if(navigator.vibrate) navigator.vibrate(isCorrect ? 10 : 50);

    if (isCorrect) {
        gameState.score += 10; 
        gameState.timeLeft = Math.min(gameState.timeLeft + CONFIG.bonusTime, CONFIG.maxTime);
        btn.classList.add('correct'); 
        updateScoreUI();
        setTimeout(() => { gameState.currentIndex++; gameState.isPlayable = true; renderQuestion(); }, 150);
    } else {
        btn.classList.add('wrong'); btn.disabled = true;
        setTimeout(() => { gameState.currentIndex++; gameState.isPlayable = true; renderQuestion(); }, 400);
    }
}

async function endGame(isClear = false) {
    clearInterval(gameState.timerId); gameState.isPlayable = false;
    $('final-score').textContent = gameState.score;

    const badge = $('result-badge');
    
    // 88문제 * 10점 = 880점 만점 기준 등급 세분화
    if(gameState.score >= 800) { 
        badge.textContent = "Rank S (1등급)"; 
        badge.className = "inline-block px-4 py-1.5 bg-blue-600 rounded-full text-xs font-bold text-white shadow-lg transform -rotate-2 border border-blue-400"; 
    }
    else if(gameState.score >= 600) { 
        badge.textContent = "Rank A (2등급)"; 
        badge.className = "inline-block px-4 py-1.5 bg-emerald-500 rounded-full text-xs font-bold text-white shadow-lg border border-emerald-400"; 
    }
    else if(gameState.score >= 400) { 
        badge.textContent = "Rank B (3등급)"; 
        badge.className = "inline-block px-4 py-1.5 bg-amber-500 rounded-full text-xs font-bold text-white shadow-lg border border-amber-400"; 
    }
    else { 
        badge.textContent = "Rank C (노력요망)"; 
        badge.className = "inline-block px-4 py-1.5 bg-slate-500 rounded-full text-xs font-bold text-white shadow-lg border border-slate-400"; 
    }
    
    showScreen('screen-result');

    try {
        const user = auth.currentUser;
        const userRef = db.collection(CONFIG.userCol).doc(user.uid);
        const weekKey = `week${gameState.week}`;
        await db.runTransaction(async t => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                const initScores = {}; for(let i=1; i<=8; i++) initScores[`week${i}`] = {score:0, elapsedTime:0};
                initScores[weekKey] = {score: gameState.score, elapsedTime: Date.now()};
                t.set(userRef, { uid: user.uid, name: gameState.nickname, totalScore: gameState.score, weeklyScores: initScores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            } else {
                const data = doc.data();
                const cur = data.weeklyScores?.[weekKey] || {score:-1};
                if (gameState.score > cur.score) {
                    const newScores = {...data.weeklyScores, [weekKey]: {score: gameState.score, elapsedTime: Date.now()}};
                    const newTotal = Object.values(newScores).reduce((sum, s) => sum + (s?.score||0), 0);
                    t.update(userRef, { weeklyScores: newScores, totalScore: newTotal, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
            }
        });
    } catch(e) { console.error("Save Error:", e); }
}

function loadLeaderboard(type) {
    const list = $('ranking-list');
    const btns = { weekly: $('tab-weekly'), total: $('tab-total') };
    
    Object.values(btns).forEach(b => { 
        b.className = "flex-1 py-3 text-xs font-bold text-slate-400 hover:text-slate-600 transition bg-slate-50 border-b border-transparent"; 
    });
    
    if(type==='weekly') btns.weekly.className = "flex-1 py-3 text-xs font-black text-blue-600 border-b-2 border-blue-600 bg-white";
    else btns.total.className = "flex-1 py-3 text-xs font-black text-blue-600 border-b-2 border-blue-600 bg-white";

    if (unsubscribeRanking) {
        unsubscribeRanking();
        unsubscribeRanking = null;
    }

    let query = db.collection(CONFIG.userCol);
    if (type === 'weekly') query = query.orderBy(`weeklyScores.week${gameState.week}.score`, 'desc');
    else query = query.orderBy('totalScore', 'desc');

    unsubscribeRanking = query.limit(30).onSnapshot(snap => {
        list.innerHTML = '';
        if (snap.empty) { list.innerHTML = '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><p class="text-xs font-medium">아직 기록이 없습니다<br>1등의 주인공이 되어보세요!</p></div>'; return; }
        
        snap.forEach((doc, idx) => {
            const data = doc.data();
            const score = type === 'weekly' ? (data.weeklyScores?.[`week${gameState.week}`]?.score || 0) : data.totalScore;
            const isMe = data.name === gameState.nickname;
            let rankClass = "text-slate-400 font-bold";
            if(idx===0) rankClass = "rank-1 font-black text-lg"; 
            else if(idx===1) rankClass = "rank-2 font-black"; 
            else if(idx===2) rankClass = "rank-3 font-black";

            const div = document.createElement('div');
            div.className = `rank-item flex justify-between items-center p-3 px-4 ${isMe ? 'my-record' : ''}`;
            div.innerHTML = `
                <div class="flex items-center gap-4 overflow-hidden">
                    <span class="rank-badge w-6 text-center ${rankClass}">${idx+1}</span>
                    <span class="text-slate-700 font-bold text-sm truncate">${data.name}</span>
                </div>
                <span class="text-blue-600 font-black text-sm flex-shrink-0">${score}</span>
            `;
            list.appendChild(div);
        });
    });
}

async function shareKakao(forChance) {
    if(!Kakao.isInitialized()) return showModal('카카오 키 오류!\n도메인을 확인해주세요.');
    try {
        if (forChance) {
            const user = auth.currentUser;
            if(user) await db.collection(CONFIG.attemptCol).doc(user.uid).update({ hasSharedToday: true });
        }
        Kakao.Share.sendDefault({
            objectType: 'feed',
            content: {
                title: '수단비 단어 챌린지 S2 🏆',
                description: `내 어휘력 등급은 몇 등급? 챔피언에 도전하세요!`,
                imageUrl: 'https://cdn.imweb.me/upload/S20250512bc351e1543759/78f771da220ea.png',
                link: { mobileWebUrl: location.href, webUrl: location.href },
            },
            buttons: [{ title: '도전하기', link: { mobileWebUrl: location.href, webUrl: location.href } }]
        });
        
        if(forChance) {
            showModal('공유 완료! 기회 획득! ⚡');
            $('btn-share-revive').classList.add('hidden'); 
            
            const btn = $('btn-start');
            btn.classList.remove('hidden');
            btn.disabled = false;
            btn.innerHTML = '<span class="relative z-10">GAME START</span>';
        }
    } catch(e) { console.error(e); showModal('공유 실패: ' + e.message); }
}

async function submitEmail() {
    const email = $('email-input').value; if(!email.includes('@')) return showModal('이메일 형식이 아닙니다.');
    try { await db.collection(CONFIG.emailCol).doc(auth.currentUser.uid).set({ email, nickname: gameState.nickname, createdAt: new Date() }, { merge: true }); showModal('등록되었습니다!'); $('email-section').style.display = 'none'; }
    catch(e) { showModal('등록 실패'); }
}

if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(user => { if (user) initApp(); else firebase.auth().signInAnonymously(); });
} else {
    window.addEventListener('load', () => {
        if (typeof firebase !== 'undefined' && firebase.auth) {
             firebase.auth().onAuthStateChanged(user => { if (user) initApp(); else firebase.auth().signInAnonymously(); });
        }
    });
}