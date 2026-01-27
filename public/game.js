// 🔥 [필수] 여기에 본인의 카카오 JavaScript 키를 붙여넣으세요!
const KAKAO_KEY = "3b220ecf82039d6604c6a42308e4dd1a"; 

// 🔄 [설정] 현재 클라이언트 버전 (Firestore 'system/config' 값과 일치시켜야 함)
const CURRENT_CLIENT_VERSION = "1.3"; 

// 📅 일정 설정 (2026년 2월 2일 월요일 00:00:00 정식 오픈)
const OFFICIAL_OPEN_DATE = new Date('2026-02-02T00:00:00+09:00'); 
const isBeta = new Date() < OFFICIAL_OPEN_DATE;

const CONFIG = {
    seasonId: 'season2', 
    userCol: isBeta ? 'users_beta' : 'users_season2',
    attemptCol: isBeta ? 'attempts_beta' : 'attempts_season2',
    emailCol: isBeta ? 'emails_beta' : 'emails_season2',
    startDate: '2026-02-02T00:00:00+09:00', 
    maxTime: 600, 
    initTime: 30, 
    bonusTime: 2.4 // ⚡️ [설정] 2.4초 보너스 (콤보 없이 고정)
};

// 전역 변수
let db, auth;
let gameState = { 
    score: 0, 
    timeLeft: CONFIG.initTime, 
    timerId: null, 
    words: [], 
    currentIndex: 0, 
    nickname: localStorage.getItem('sudanbi_nickname') || '', 
    week: 1, 
    isPlayable: true,
    startTime: 0 // 🕒 타임어택 시작 시간
};
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

    // 🔄 버전 체크 및 강제 업데이트
    db.collection('system').doc('config').onSnapshot((doc) => {
        if (doc.exists) {
            const serverVersion = doc.data().version;
            if (serverVersion && serverVersion !== CURRENT_CLIENT_VERSION) {
                showModal('새로운 업데이트가 있습니다! 🚀\n최적화를 위해 다시 시작합니다.');
                setTimeout(() => { window.location.reload(true); }, 2000);
            }
        }
    });

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
    let week = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7)) + 1;
    if (week < 1) week = 1; 
    if (week > 4) week = 4;
    gameState.week = week;
    
    const weekStart = new Date(start); weekStart.setDate(start.getDate() + (week-1)*7);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    
    $('season-week').textContent = `WEEK ${week}`;
    $('season-date').textContent = `${weekStart.getMonth()+1}.${weekStart.getDate()} ~ ${weekEnd.getMonth()+1}.${weekEnd.getDate()}`;

    const banner = $('season-banner');
    if (isBeta) {
        banner.textContent = "🚧 프리시즌(BETA) : 기록은 2/2 초기화";
        banner.className = "w-full text-center py-2 text-[10px] font-black tracking-widest uppercase bg-yellow-400 text-slate-900 shadow-sm";
    } else {
        banner.textContent = "🏆 수단비 단어 챌린지 S2";
        banner.className = "w-full text-center py-2 text-[10px] font-black tracking-widest uppercase bg-slate-900 text-white";
    }
}

// --- 게임 시작 ---
async function tryStartGame() {
    const nickname = $('nickname-input').value.trim();
    if (nickname.length < 2) return showModal('닉네임을\n2자 이상 입력해주세요.');

    const btn = $('btn-start');
    const originalText = '<span class="relative z-10">GAME START</span>';
    btn.disabled = true; 
    btn.innerHTML = '<span class="animate-pulse">LOADING...</span>';

    try {
        if (unsubscribeRanking) { unsubscribeRanking(); unsubscribeRanking = null; }

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
                btn.classList.add('hidden'); btn.disabled = false; btn.innerHTML = originalText;
                $('btn-share-revive').classList.remove('hidden');
                return showModal('기회 소진! 😱\n공유하면 한 번 더 할 수 있어요!');
            }
        }
        await loadWordsAndStart();
    } catch (e) {
        btn.disabled = false; btn.innerHTML = originalText;
        showModal(e.message || '오류가 발생했습니다.');
        loadLeaderboard('weekly'); 
    }
}

async function loadWordsAndStart() {
    const cacheKey = `${CONFIG.seasonId}_w${gameState.week}_v3`;
    let words = JSON.parse(localStorage.getItem(cacheKey));
    
    if (!words) {
        const doc = await db.collection('seasons').doc(CONFIG.seasonId).get();
        if (doc.exists) { 
            words = doc.data()[`Week ${gameState.week}`] || []; 
            if(words.length) localStorage.setItem(cacheKey, JSON.stringify(words));
        }
    }
    
    if (!words || !words.length) {
        $('btn-start').disabled = false; $('btn-start').innerHTML = '<span class="relative z-10">GAME START</span>';
        loadLeaderboard('weekly');
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
    gameState.currentIndex = 0; 
    gameState.score = 0; 
    gameState.timeLeft = CONFIG.initTime; 
    gameState.isPlayable = true;
    gameState.startTime = Date.now(); // 🕒 시작 시간 기록

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
    void wordEl.offsetWidth; 
    wordEl.classList.add('animate-pop-in');
    wordEl.textContent = wordData['단어'];
    
    const badge = $('freq-badge');
    if (wordData['역대 기출'] && wordData['역대 기출'] !== "0") { 
        badge.textContent = `🔥 수능 기출 ${wordData['역대 기출']}회`; badge.style.opacity = 1; badge.style.transform = 'translateY(0)';
    } else {
        badge.style.opacity = 0; badge.style.transform = 'translateY(10px)';
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
            if(gameState.isPlayable) { e.target.blur(); handleAnswer(btn, ans.isCorrect); } 
        };
        container.appendChild(btn);
    });
}

function handleAnswer(btn, isCorrect) {
    gameState.isPlayable = false;
    if(navigator.vibrate) navigator.vibrate(isCorrect ? 10 : 50);

    if (isCorrect) {
        gameState.score += 10; 
        // ⚡️ [2.4초 보너스] 콤보 로직 제거하고 단순 적용
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
    const playTimeSec = Math.floor((Date.now() - gameState.startTime) / 1000);

    const badge = $('result-badge');
    if(gameState.score >= 800) { badge.textContent = "Rank S (1등급)"; badge.className = "inline-block px-4 py-1.5 bg-blue-600 rounded-full text-xs font-bold text-white shadow-lg transform -rotate-2 border border-blue-400"; }
    else if(gameState.score >= 600) { badge.textContent = "Rank A (2등급)"; badge.className = "inline-block px-4 py-1.5 bg-emerald-500 rounded-full text-xs font-bold text-white shadow-lg border border-emerald-400"; }
    else if(gameState.score >= 400) { badge.textContent = "Rank B (3등급)"; badge.className = "inline-block px-4 py-1.5 bg-amber-500 rounded-full text-xs font-bold text-white shadow-lg border border-amber-400"; }
    else { badge.textContent = "Rank C (노력요망)"; badge.className = "inline-block px-4 py-1.5 bg-slate-500 rounded-full text-xs font-bold text-white shadow-lg border border-slate-400"; }
    
    showScreen('screen-result');

    try {
        const user = auth.currentUser;
        const userRef = db.collection(CONFIG.userCol).doc(user.uid);
        const weekKey = `week${gameState.week}`;
        
        await db.runTransaction(async t => {
            const doc = await t.get(userRef);
            // playTime 저장
            const newRecord = { score: gameState.score, playTime: playTimeSec, createdAt: Date.now() };

            if (!doc.exists) {
                const initScores = {}; for(let i=1; i<=8; i++) initScores[`week${i}`] = {score:0, playTime:0};
                initScores[weekKey] = newRecord;
                t.set(userRef, { 
                    uid: user.uid, name: gameState.nickname, 
                    totalScore: gameState.score, totalPlayTime: playTimeSec,
                    weeklyScores: initScores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                });
            } else {
                const data = doc.data();
                const cur = data.weeklyScores?.[weekKey] || {score: -1};
                
                // 🏆 [갱신 조건] 1.점수 높음 OR 2.점수 같고 시간 짧음 OR 3.기존기록 시간정보 없음
                const curPlayTime = cur.playTime !== undefined ? cur.playTime : 99999;
                
                if (gameState.score > cur.score || (gameState.score === cur.score && playTimeSec < curPlayTime)) {
                    const newScores = {...data.weeklyScores, [weekKey]: newRecord};
                    
                    let newTotalScore = 0; let newTotalTime = 0;
                    Object.values(newScores).forEach(s => {
                        if (s && s.score) { newTotalScore += s.score; newTotalTime += (s.playTime || 0); }
                    });

                    t.update(userRef, { 
                        weeklyScores: newScores, totalScore: newTotalScore, totalPlayTime: newTotalTime,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                    });
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

    if (unsubscribeRanking) { unsubscribeRanking(); unsubscribeRanking = null; }

    let query = db.collection(CONFIG.userCol);
    if (type === 'weekly') {
        // [주의] Firestore 색인이 없거나, 기존 데이터에 playTime 필드가 없으면 결과가 안 나옴!
        query = query.orderBy(`weeklyScores.week${gameState.week}.score`, 'desc')
                     .orderBy(`weeklyScores.week${gameState.week}.playTime`, 'asc');
    } else {
        query = query.orderBy('totalScore', 'desc').orderBy('totalPlayTime', 'asc');
    }

    unsubscribeRanking = query.limit(30).onSnapshot(snap => {
        list.innerHTML = '';
        if (snap.empty) { list.innerHTML = '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><p class="text-xs font-medium">아직 기록이 없습니다<br>1등의 주인공이 되어보세요!</p></div>'; return; }
        
        snap.forEach((doc, idx) => {
            const data = doc.data();
            const weekData = data.weeklyScores?.[`week${gameState.week}`];
            
            // 🛡️ [안전장치] 값이 없으면 0으로 표시
            const score = type === 'weekly' ? (weekData?.score || 0) : (data.totalScore || 0);
            const timeValue = type === 'weekly' ? weekData?.playTime : data.totalPlayTime;

            let timeHtml = '';
            // playTime이 있는 경우에만 표시
            if (timeValue !== undefined) {
                const sec = timeValue;
                const min = Math.floor(sec / 60);
                const restSec = sec % 60;
                const timeText = min > 0 ? `${min}m ${restSec}s` : `${sec}s`;
                
                timeHtml = `<div class="text-[10px] text-slate-400 font-medium mt-0.5 flex items-center justify-end gap-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 opacity-70"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75l4 2a.75.75 0 00.75-1.25l-3.5-1.75V5z" clip-rule="evenodd" /></svg>
                    ${timeText} Cut
                </div>`;
            }

            const isMe = data.name === gameState.nickname;
            let rankClass = "text-slate-400 font-bold";
            if(idx===0) rankClass = "rank-1 font-black text-lg"; 
            else if(idx===1) rankClass = "rank-2 font-black"; 
            else if(idx===2) rankClass = "rank-3 font-black";

            const div = document.createElement('div');
            div.className = `rank-item flex justify-between items-center p-3 px-4 ${isMe ? 'my-record' : ''}`;
            
            div.innerHTML = `
                <div class="flex items-center gap-3 overflow-hidden">
                    <span class="rank-badge w-6 text-center ${rankClass} shrink-0">${idx+1}</span>
                    <span class="text-slate-700 font-bold text-sm truncate">${data.name}</span>
                </div>
                <div class="text-right shrink-0">
                    <span class="block text-blue-600 font-black text-sm leading-none">${score}</span>
                    ${timeHtml}
                </div>
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
            btn.classList.remove('hidden'); btn.disabled = false;
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