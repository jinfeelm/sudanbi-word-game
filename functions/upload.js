const admin = require("firebase-admin");
const serviceAccount = require("./key.json"); // 방금 받은 열쇠 파일
const data = require("./season2_balanced_data.json"); // 단어 데이터 파일

// 관리자 권한으로 시작
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadData() {
  console.log("🚀 데이터 업로드를 시작합니다...");

  // seasons 컬렉션의 season2 문서에 덮어쓰기
  try {
    // season2 문서에 데이터 한 방에 저장 (set을 쓰면 기존 내용 덮어씀)
    await db.collection("seasons").doc("season2").set(data);
    console.log("✅ 업로드 성공! season2 데이터가 완벽하게 들어갔습니다.");
  } catch (error) {
    console.error("❌ 실패... 에러 내용을 확인하세요:", error);
  }
}

uploadData();