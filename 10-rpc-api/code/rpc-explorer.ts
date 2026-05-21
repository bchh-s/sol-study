/**
 * Solana RPC Explorer
 *
 * Dagaon Core Solana 통합을 위한 RPC 메서드 학습용 코드.
 * devnet에 대해 주요 RPC 메서드를 실행하고 응답을 fixtures/ 디렉토리에 저장한다.
 *
 * 실행: npx tsx rpc-explorer.ts
 * 의존성: npm install
 */

import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const RPC_HTTP = "https://api.devnet.solana.com";
const RPC_WS = "wss://api.devnet.solana.com";
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// devnet에 항상 존재하는 잘 알려진 주소 (System Program)
const KNOWN_ADDRESS = "11111111111111111111111111111111";

// USDC devnet mint (Circle 공식 devnet USDC)
const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// ---------------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------------

let rpcId = 0;

/** JSON-RPC 요청을 보내고 결과를 반환한다. */
async function rpcCall(method: string, params: unknown[] = []): Promise<any> {
  rpcId++;
  const body = {
    jsonrpc: "2.0",
    id: rpcId,
    method,
    params,
  };

  const res = await fetch(RPC_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json: any = await res.json();
  if (json.error) {
    throw new Error(`RPC error [${json.error.code}]: ${json.error.message}`);
  }
  return json;
}

/** fixture 파일로 저장한다. */
function saveFixture(name: string, data: unknown): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  const filePath = path.join(FIXTURES_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  -> fixture 저장: fixtures/${name}.json`);
}

function separator(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}\n`);
}

// ---------------------------------------------------------------------------
// 1. 블록 싱크 관련 RPC
// ---------------------------------------------------------------------------

async function exploreBlockSyncRPC(): Promise<{
  slot: number;
  blockHeight: number;
  sampleSlots: number[];
}> {
  separator("1. 블록 싱크 관련 HTTP RPC");

  // --- getSlot ---
  console.log("[getSlot] 현재 finalized 슬롯 조회...");
  const slotResp = await rpcCall("getSlot", [{ commitment: "finalized" }]);
  const currentSlot: number = slotResp.result;
  console.log(`  현재 finalized 슬롯: ${currentSlot}`);
  saveFixture("getSlot", slotResp);

  // --- getBlockHeight ---
  console.log("\n[getBlockHeight] 현재 finalized 블록 높이 조회...");
  const heightResp = await rpcCall("getBlockHeight", [
    { commitment: "finalized" },
  ]);
  const blockHeight: number = heightResp.result;
  console.log(`  현재 finalized 블록 높이: ${blockHeight}`);
  console.log(`  slot - height = ${currentSlot - blockHeight} (빈 슬롯 수 추정)`);
  saveFixture("getBlockHeight", heightResp);

  // --- getBlocks ---
  const rangeStart = currentSlot - 20;
  const rangeEnd = currentSlot;
  console.log(
    `\n[getBlocks] 슬롯 ${rangeStart}~${rangeEnd} 범위의 블록 목록 조회...`
  );
  const blocksResp = await rpcCall("getBlocks", [
    rangeStart,
    rangeEnd,
    { commitment: "finalized" },
  ]);
  const slots: number[] = blocksResp.result;
  console.log(`  블록이 있는 슬롯 수: ${slots.length} / 범위 ${rangeEnd - rangeStart + 1}`);
  console.log(`  슬롯 목록 (처음 5개): ${slots.slice(0, 5).join(", ")}${slots.length > 5 ? " ..." : ""}`);
  saveFixture("getBlocks", blocksResp);

  // --- getBlock ---
  const targetSlot = slots.length > 0 ? slots[slots.length - 1] : currentSlot;
  console.log(`\n[getBlock] 슬롯 ${targetSlot}의 블록 데이터 조회...`);
  const blockResp = await rpcCall("getBlock", [
    targetSlot,
    {
      encoding: "jsonParsed",
      transactionDetails: "full",
      rewards: false,
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  const block = blockResp.result;
  if (block) {
    console.log(`  blockhash: ${block.blockhash}`);
    console.log(`  previousBlockhash: ${block.previousBlockhash}`);
    console.log(`  parentSlot: ${block.parentSlot}`);
    console.log(`  blockHeight: ${block.blockHeight}`);
    console.log(`  blockTime: ${block.blockTime} (${new Date((block.blockTime ?? 0) * 1000).toISOString()})`);
    console.log(`  트랜잭션 수: ${block.transactions?.length ?? 0}`);
    console.log(`  blockhash 길이: ${block.blockhash?.length}자`);

    // signatures-only 버전도 저장 (전체 block은 너무 큼)
    const lightBlock = {
      blockhash: block.blockhash,
      previousBlockhash: block.previousBlockhash,
      parentSlot: block.parentSlot,
      blockHeight: block.blockHeight,
      blockTime: block.blockTime,
      txCount: block.transactions?.length ?? 0,
      firstTxSignature: block.transactions?.[0]?.transaction?.signatures?.[0],
    };
    saveFixture("getBlock-light", { jsonrpc: "2.0", result: lightBlock });
  } else {
    console.log("  블록 데이터가 null (빈 슬롯 또는 미확인)");
  }

  // --- getBlockTime ---
  console.log(`\n[getBlockTime] 슬롯 ${targetSlot}의 블록 시간 조회...`);
  const blockTimeResp = await rpcCall("getBlockTime", [targetSlot]);
  console.log(
    `  blockTime: ${blockTimeResp.result} (${new Date((blockTimeResp.result ?? 0) * 1000).toISOString()})`
  );
  saveFixture("getBlockTime", blockTimeResp);

  // --- getTransaction (블록에 TX가 있는 경우) ---
  const firstSig =
    block?.transactions?.[0]?.transaction?.signatures?.[0];
  if (firstSig) {
    console.log(`\n[getTransaction] 서명 ${firstSig.slice(0, 20)}... 조회...`);
    const txResp = await rpcCall("getTransaction", [
      firstSig,
      {
        encoding: "jsonParsed",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (txResp.result) {
      console.log(`  slot: ${txResp.result.slot}`);
      console.log(`  blockTime: ${txResp.result.blockTime}`);
      console.log(`  서명 길이: ${firstSig.length}자`);
      console.log(`  meta.err: ${JSON.stringify(txResp.result.meta?.err)}`);
      console.log(`  meta.fee: ${txResp.result.meta?.fee} lamports`);
    }
    // TX 응답은 매우 클 수 있으므로 meta만 저장
    const lightTx = {
      slot: txResp.result?.slot,
      blockTime: txResp.result?.blockTime,
      signature: firstSig,
      signatureLength: firstSig.length,
      meta: {
        err: txResp.result?.meta?.err,
        fee: txResp.result?.meta?.fee,
        computeUnitsConsumed: txResp.result?.meta?.computeUnitsConsumed,
        logMessages: txResp.result?.meta?.logMessages?.slice(0, 5),
      },
      version: txResp.result?.version,
    };
    saveFixture("getTransaction-light", {
      jsonrpc: "2.0",
      result: lightTx,
    });
  }

  // --- getSignaturesForAddress ---
  // System Program 주소는 TX가 많으므로 테스트에 적합
  console.log(
    `\n[getSignaturesForAddress] System Program 주소의 최근 서명 5개 조회...`
  );
  const sigsResp = await rpcCall("getSignaturesForAddress", [
    KNOWN_ADDRESS,
    { limit: 5, commitment: "finalized" },
  ]);
  const sigs = sigsResp.result;
  if (Array.isArray(sigs)) {
    console.log(`  반환된 서명 수: ${sigs.length}`);
    for (const sig of sigs.slice(0, 3)) {
      console.log(
        `    ${sig.signature.slice(0, 30)}... slot=${sig.slot} err=${JSON.stringify(sig.err)} status=${sig.confirmationStatus}`
      );
    }
  }
  saveFixture("getSignaturesForAddress", sigsResp);

  return { slot: currentSlot, blockHeight, sampleSlots: slots };
}

// ---------------------------------------------------------------------------
// 2. 잔액/계정 조회 RPC
// ---------------------------------------------------------------------------

async function exploreBalanceAccountRPC(): Promise<void> {
  separator("2. 잔액/계정 조회 HTTP RPC");

  // devnet faucet 주소 또는 잘 알려진 주소 사용
  // System Program은 항상 존재하지만 일반 계정이 아님
  // devnet에서 임의의 활성 주소를 사용
  const testAddress = "9B5XszUGdMaxCZ7uSQhPzdks5ZQSmWxrmzCSvtJ6Ns6g";

  // --- getBalance ---
  console.log(`[getBalance] 주소 ${testAddress.slice(0, 15)}... 의 SOL 잔액 조회...`);
  const balResp = await rpcCall("getBalance", [
    testAddress,
    { commitment: "finalized" },
  ]);
  const lamports: number = balResp.result?.value ?? 0;
  console.log(`  잔액: ${lamports} lamports = ${lamports / 1e9} SOL`);
  console.log(`  context.slot: ${balResp.result?.context?.slot}`);
  saveFixture("getBalance", balResp);

  // --- getAccountInfo ---
  console.log(`\n[getAccountInfo] System Program 계정 정보 조회...`);
  const accResp = await rpcCall("getAccountInfo", [
    KNOWN_ADDRESS,
    { encoding: "jsonParsed", commitment: "finalized" },
  ]);
  const accInfo = accResp.result?.value;
  if (accInfo) {
    console.log(`  owner: ${accInfo.owner}`);
    console.log(`  lamports: ${accInfo.lamports}`);
    console.log(`  executable: ${accInfo.executable}`);
    console.log(`  space: ${accInfo.space}`);
    console.log(`  rentEpoch: ${accInfo.rentEpoch}`);
  } else {
    console.log("  계정 정보가 null (존재하지 않는 계정)");
  }
  saveFixture("getAccountInfo", accResp);

  // --- getTokenAccountsByOwner ---
  console.log(
    `\n[getTokenAccountsByOwner] 주소 ${testAddress.slice(0, 15)}...의 모든 SPL 토큰 계정 조회...`
  );
  const tokenAccsResp = await rpcCall("getTokenAccountsByOwner", [
    testAddress,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed", commitment: "finalized" },
  ]);
  const tokenAccs = tokenAccsResp.result?.value ?? [];
  console.log(`  발견된 토큰 계정 수: ${tokenAccs.length}`);
  for (const ta of tokenAccs.slice(0, 3)) {
    const info = ta.account?.data?.parsed?.info;
    if (info) {
      console.log(
        `    mint=${info.mint?.slice(0, 15)}... amount=${info.tokenAmount?.uiAmountString} (${info.tokenAmount?.amount} raw)`
      );
    }
  }
  saveFixture("getTokenAccountsByOwner", tokenAccsResp);

  // --- getTokenAccountBalance (토큰 계정이 있는 경우) ---
  if (tokenAccs.length > 0) {
    const firstTokenAccPubkey = tokenAccs[0].pubkey;
    console.log(
      `\n[getTokenAccountBalance] 토큰 계정 ${firstTokenAccPubkey.slice(0, 15)}... 잔액 조회...`
    );
    const tabResp = await rpcCall("getTokenAccountBalance", [
      firstTokenAccPubkey,
      { commitment: "finalized" },
    ]);
    const tokenBal = tabResp.result?.value;
    if (tokenBal) {
      console.log(`  amount: ${tokenBal.amount} (raw)`);
      console.log(`  decimals: ${tokenBal.decimals}`);
      console.log(`  uiAmount: ${tokenBal.uiAmount}`);
      console.log(`  uiAmountString: ${tokenBal.uiAmountString}`);
    }
    saveFixture("getTokenAccountBalance", tabResp);
  } else {
    console.log("\n[getTokenAccountBalance] 토큰 계정이 없어 건너뜀");
  }

  // --- getMinimumBalanceForRentExemption ---
  console.log(
    "\n[getMinimumBalanceForRentExemption] 주요 데이터 크기별 rent-exempt 비용..."
  );
  const sizes = [
    { name: "System Account (0 bytes)", size: 0 },
    { name: "Nonce Account (80 bytes)", size: 80 },
    { name: "Mint Account (82 bytes)", size: 82 },
    { name: "Token Account (165 bytes)", size: 165 },
  ];

  const rentResults: Record<string, { size: number; lamports: number; sol: number }> = {};
  for (const { name, size } of sizes) {
    const rentResp = await rpcCall("getMinimumBalanceForRentExemption", [size]);
    const rentLamports: number = rentResp.result;
    console.log(
      `  ${name}: ${rentLamports} lamports = ${rentLamports / 1e9} SOL`
    );
    rentResults[name] = {
      size,
      lamports: rentLamports,
      sol: rentLamports / 1e9,
    };
  }
  saveFixture("getMinimumBalanceForRentExemption", rentResults);
}

// ---------------------------------------------------------------------------
// 3. TX 전송/확인 관련 RPC
// ---------------------------------------------------------------------------

async function exploreTxSendConfirmRPC(): Promise<void> {
  separator("3. TX 전송/확인 관련 HTTP RPC");

  // --- getLatestBlockhash ---
  console.log("[getLatestBlockhash] 최신 blockhash 조회...");
  const bhResp = await rpcCall("getLatestBlockhash", [
    { commitment: "finalized" },
  ]);
  const bh = bhResp.result?.value;
  if (bh) {
    console.log(`  blockhash: ${bh.blockhash}`);
    console.log(`  lastValidBlockHeight: ${bh.lastValidBlockHeight}`);
    console.log(`  blockhash 길이: ${bh.blockhash.length}자`);
  }
  saveFixture("getLatestBlockhash", bhResp);

  // --- getRecentPrioritizationFees ---
  console.log("\n[getRecentPrioritizationFees] 최근 priority fee 통계 조회...");
  const feesResp = await rpcCall("getRecentPrioritizationFees", []);
  const fees = feesResp.result ?? [];
  if (fees.length > 0) {
    const feeValues = fees.map((f: any) => f.prioritizationFee);
    const nonZeroFees = feeValues.filter((f: number) => f > 0);
    const maxFee = Math.max(...feeValues);
    const minFee = Math.min(...feeValues);

    // 중앙값 계산
    const sorted = [...feeValues].sort((a: number, b: number) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    console.log(`  반환된 슬롯 수: ${fees.length}`);
    console.log(`  fee 범위: ${minFee} ~ ${maxFee} micro-lamports`);
    console.log(`  fee 중앙값: ${median} micro-lamports`);
    console.log(`  fee > 0인 슬롯 수: ${nonZeroFees.length}/${fees.length}`);

    // 처음 5개만 저장
    saveFixture("getRecentPrioritizationFees", {
      summary: {
        count: fees.length,
        min: minFee,
        max: maxFee,
        median,
        nonZeroCount: nonZeroFees.length,
      },
      samples: fees.slice(0, 10),
    });
  }

  // --- getSignatureStatuses ---
  // 최근 getSignaturesForAddress에서 조회한 서명으로 상태 확인
  console.log(
    "\n[getSignatureStatuses] System Program의 최근 서명 상태 배치 조회..."
  );
  const sigsResp = await rpcCall("getSignaturesForAddress", [
    KNOWN_ADDRESS,
    { limit: 3, commitment: "finalized" },
  ]);
  const recentSigs = (sigsResp.result ?? []).map((s: any) => s.signature);

  if (recentSigs.length > 0) {
    const statusResp = await rpcCall("getSignatureStatuses", [
      recentSigs,
      { searchTransactionHistory: true },
    ]);
    const statuses = statusResp.result?.value ?? [];
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i];
      if (s) {
        console.log(
          `  [${i}] ${recentSigs[i].slice(0, 25)}... -> slot=${s.slot} confirmationStatus=${s.confirmationStatus} err=${JSON.stringify(s.err)}`
        );
      } else {
        console.log(`  [${i}] ${recentSigs[i].slice(0, 25)}... -> null (미확인)`);
      }
    }
    saveFixture("getSignatureStatuses", statusResp);
  }

  // --- sendTransaction / simulateTransaction ---
  console.log("\n[sendTransaction / simulateTransaction]");
  console.log(
    "  서명된 TX가 없으므로 이 단계는 건너뜀 (실제 사용 시 KMS 서명 후 호출)"
  );
  console.log("  sendTransaction: base64 인코딩된 서명 TX를 params[0]으로 전달");
  console.log("  simulateTransaction: replaceRecentBlockhash=true로 로직 검증 가능");
}

// ---------------------------------------------------------------------------
// 4. WebSocket 구독
// ---------------------------------------------------------------------------

async function exploreWebSocket(): Promise<void> {
  separator("4. WebSocket 구독 (slotSubscribe - 5초간 수신)");

  return new Promise((resolve) => {
    console.log(`WebSocket 연결: ${RPC_WS}`);

    const ws = new WebSocket(RPC_WS);
    let subscriptionId: number | null = null;
    const notifications: any[] = [];
    let timeout: ReturnType<typeof setTimeout>;

    ws.on("open", () => {
      console.log("  연결됨. slotSubscribe 요청...");
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "slotSubscribe",
        })
      );

      // 5초 후 구독 해제 및 연결 종료
      timeout = setTimeout(() => {
        console.log(`\n  5초 경과. ${notifications.length}개 알림 수신. 구독 해제...`);

        if (subscriptionId !== null) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "slotUnsubscribe",
              params: [subscriptionId],
            })
          );
        }

        // 알림 요약
        if (notifications.length > 0) {
          const slots = notifications.map((n) => n.result?.slot ?? 0);
          const roots = notifications.map((n) => n.result?.root ?? 0);
          console.log(
            `  슬롯 범위: ${Math.min(...slots)} ~ ${Math.max(...slots)}`
          );
          console.log(
            `  root(finalized) 범위: ${Math.min(...roots)} ~ ${Math.max(...roots)}`
          );
          console.log(
            `  알림 빈도: ~${(5000 / notifications.length).toFixed(0)}ms/알림`
          );
        }

        saveFixture("slotSubscribe-notifications", {
          duration: "5 seconds",
          count: notifications.length,
          samples: notifications.slice(0, 5),
        });

        // 잠시 후 연결 종료
        setTimeout(() => {
          ws.close();
        }, 500);
      }, 5000);
    });

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());

      // 구독 응답
      if (msg.id === 1 && msg.result !== undefined) {
        subscriptionId = msg.result;
        console.log(`  구독 ID: ${subscriptionId}`);
        saveFixture("slotSubscribe-response", msg);
        return;
      }

      // 구독 해제 응답
      if (msg.id === 2) {
        console.log(`  구독 해제 결과: ${msg.result}`);
        return;
      }

      // 알림
      if (msg.method === "slotNotification") {
        notifications.push(msg.params);
        const result = msg.params?.result;
        if (notifications.length <= 3) {
          console.log(
            `  [알림 #${notifications.length}] slot=${result?.slot} parent=${result?.parent} root=${result?.root}`
          );
        } else if (notifications.length === 4) {
          console.log("  ... (이후 알림 생략, fixture에서 확인)");
        }
      }
    });

    ws.on("error", (err: Error) => {
      console.error(`  WebSocket 에러: ${err.message}`);
    });

    ws.on("close", () => {
      console.log("  WebSocket 연결 종료");
      clearTimeout(timeout);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("  Solana RPC Explorer - devnet");
  console.log("  Dagaon Core Solana 통합 학습용");
  console.log(`  실행 시각: ${new Date().toISOString()}`);
  console.log("============================================================");

  try {
    // 1. 블록 싱크 RPC
    await exploreBlockSyncRPC();

    // 2. 잔액/계정 조회 RPC
    await exploreBalanceAccountRPC();

    // 3. TX 전송/확인 RPC
    await exploreTxSendConfirmRPC();

    // 4. WebSocket 구독
    await exploreWebSocket();

    // 완료 요약
    separator("완료 요약");

    const fixtureFiles = fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"));
    console.log(`저장된 fixture 파일 수: ${fixtureFiles.length}`);
    for (const f of fixtureFiles) {
      const stat = fs.statSync(path.join(FIXTURES_DIR, f));
      console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
    }

    console.log("\n모든 RPC 메서드 탐색 완료.");
  } catch (err) {
    console.error("\n에러 발생:", err);
    process.exit(1);
  }
}

main();
