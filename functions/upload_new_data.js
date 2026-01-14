const admin = require("firebase-admin");

// 1. 관리자 키 가져오기 (파일 이름이 key.json이 맞는지 꼭 확인하세요!)
const serviceAccount = require("./key.json"); 

// 2. 우리가 만든 최신 데이터 가져오기
const data = require("./season2_final_game_data.json");

// 3. Firebase 접속!
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadData() {
  console.log("🚀 시즌2 데이터 업로드를 시작합니다...");

  try {
    // 'seasons' 컬렉션의 'season2' 문서에 데이터를 통째로 덮어씌웁니다.
    // set() 함수는 기존 내용이 있어도 싹 지우고 새로 쓰니까 깔끔해요!
    await db.collection("seasons").doc("season2").set(data);
    
    console.log("---------------------------------------------------");
    console.log("✅ 업로드 완료! 'season2_final_game_data.json'이 서버에 저장되었습니다.");
    console.log("👉 이제 게임을 새로고침하면 바뀐 단어들이 나올 거예요!");
    console.log("---------------------------------------------------");

  } catch (error) {
    console.error("❌ 업로드 실패... 에러를 확인해주세요:", error);
  }
}

uploadData();