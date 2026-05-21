/**
 * Solana Account Explorer
 *
 * devnet에서 다양한 Solana 계정 유형을 조회하고 비교하는 학습용 스크립트.
 *
 * 실행 방법:
 *   npm install
 *   npx ts-node account-explorer.ts
 *
 * 다루는 내용:
 *   1. System Account (SOL 지갑) - 5가지 필드 조회
 *   2. SPL Token Mint Account - mint 데이터 디코딩
 *   3. Associated Token Account (ATA) - owner, mint, amount 조회
 *   4. Rent-exempt 보증금 계산
 *   5. PDA (Program Derived Address) 도출
 *   6. 계정 유형별 차이 비교
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  AccountInfo,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  getAssociatedTokenAddressSync,
  AccountLayout,
  MintLayout,
} from "@solana/spl-token";

// ============================================================
// 설정
// ============================================================

const DEVNET_URL = clusterApiUrl("devnet");
const connection = new Connection(DEVNET_URL, "confirmed");

// 잘 알려진 devnet/mainnet 주소 (실제 존재하는 계정)
// USDC on mainnet (devnet에서는 다를 수 있음)
const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

// System Program ID
const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);

// 구분선 출력
function separator(title: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function subSeparator(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ============================================================
// 1. System Account (SOL 지갑) 조회 - 5가지 필드
// ============================================================

async function exploreSystemAccount(): Promise<void> {
  separator("1. System Account (SOL 지갑) - 5가지 필드 조회");

  // devnet의 faucet/known 주소 사용 (Solana Foundation 주소)
  // 실제 devnet에서 잔액이 있는 주소를 사용
  const knownAddress = new PublicKey(
    "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"
  );

  console.log(`\n조회 대상: ${knownAddress.toBase58()}`);

  const accountInfo: AccountInfo<Buffer> | null =
    await connection.getAccountInfo(knownAddress);

  if (accountInfo) {
    console.log("\n[Account의 5가지 필드]");
    console.log(
      `  1. lamports:    ${accountInfo.lamports} (${(accountInfo.lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL)`
    );
    console.log(
      `  2. data:        ${accountInfo.data.length} bytes (비어있음 = 일반 SOL 지갑)`
    );
    console.log(`  3. owner:       ${accountInfo.owner.toBase58()}`);
    console.log(
      `     → owner가 System Program (${SYSTEM_PROGRAM_ID.toBase58()}) = 일반 SOL 계정`
    );
    console.log(`  4. executable:  ${accountInfo.executable}`);
    console.log(`  5. rentEpoch:   ${accountInfo.rentEpoch}`);

    console.log("\n[해석]");
    console.log("  - data가 0 bytes → 일반 SOL 지갑 (System Account)");
    console.log("  - owner가 System Program → System Program이 이 계정을 관리");
    console.log("  - executable이 false → 프로그램 코드가 아닌 데이터 계정");
  } else {
    console.log("  계정을 찾을 수 없습니다. devnet에서 다른 주소를 시도해보세요.");
    console.log("  참고: devnet은 주기적으로 리셋되므로 계정이 사라질 수 있습니다.");
  }
}

// ============================================================
// 2. SPL Token Mint Account 디코딩
// ============================================================

async function exploreMintAccount(): Promise<void> {
  separator("2. SPL Token Mint Account - 데이터 디코딩");

  // devnet에서 Token Program이 소유한 mint 계정을 찾기 위해
  // 직접 mint 데이터 구조를 설명
  console.log("\n[Mint Account 데이터 구조 (82 bytes)]");
  console.log("  Offset  Size  Field");
  console.log("  ------  ----  -----");
  console.log("  0       4     mintAuthorityOption (COption<Pubkey>)");
  console.log("  4       32    mintAuthority");
  console.log("  36      8     supply (u64)");
  console.log("  44      1     decimals (u8)");
  console.log("  45      1     isInitialized (bool)");
  console.log("  46      4     freezeAuthorityOption (COption<Pubkey>)");
  console.log("  50      32    freezeAuthority");
  console.log("  합계: 82 bytes");

  // Mainnet USDC mint 조회 시도 (mainnet RPC 사용)
  const mainnetConnection = new Connection(
    clusterApiUrl("mainnet-beta"),
    "confirmed"
  );

  console.log(`\n[Mainnet USDC Mint 조회: ${USDC_MINT_MAINNET.toBase58()}]`);

  try {
    const mintInfo = await getMint(mainnetConnection, USDC_MINT_MAINNET);

    console.log(`  address:          ${mintInfo.address.toBase58()}`);
    console.log(
      `  supply:           ${mintInfo.supply.toString()} (raw)`
    );
    console.log(
      `  supply (읽기):    ${(Number(mintInfo.supply) / 10 ** mintInfo.decimals).toLocaleString()} USDC`
    );
    console.log(`  decimals:         ${mintInfo.decimals}`);
    console.log(`  isInitialized:    ${mintInfo.isInitialized}`);
    console.log(
      `  mintAuthority:    ${mintInfo.mintAuthority?.toBase58() ?? "null"}`
    );
    console.log(
      `  freezeAuthority:  ${mintInfo.freezeAuthority?.toBase58() ?? "null"}`
    );

    // raw account info도 확인
    const rawAccount = await mainnetConnection.getAccountInfo(
      USDC_MINT_MAINNET
    );
    if (rawAccount) {
      console.log(`\n[Raw Account Info]`);
      console.log(`  owner:       ${rawAccount.owner.toBase58()}`);
      console.log(
        `  → Token Program (${TOKEN_PROGRAM_ID.toBase58()}) 이 소유`
      );
      console.log(`  data 크기:   ${rawAccount.data.length} bytes`);
      console.log(`  executable:  ${rawAccount.executable}`);
      console.log(
        `  lamports:    ${rawAccount.lamports} (${(rawAccount.lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL rent 보증금)`
      );
    }
  } catch (err) {
    console.log(
      `  Mainnet 조회 실패: ${err instanceof Error ? err.message : String(err)}`
    );
    console.log("  → rate limit이나 네트워크 문제일 수 있습니다.");
  }
}

// ============================================================
// 3. Associated Token Account (ATA) 조회
// ============================================================

async function exploreATA(): Promise<void> {
  separator("3. Associated Token Account (ATA) - owner, mint, amount");

  // ATA 주소 도출 과정 설명
  console.log("\n[ATA 주소 도출 방법]");
  console.log("  PDA = findProgramAddress(");
  console.log("    [wallet_address, TOKEN_PROGRAM_ID, mint_address],");
  console.log("    ASSOCIATED_TOKEN_PROGRAM_ID");
  console.log("  )");

  // 예시 지갑으로 ATA 주소 도출
  const exampleWallet = new PublicKey(
    "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"
  );

  console.log(`\n[ATA 도출 예시]`);
  console.log(`  지갑:   ${exampleWallet.toBase58()}`);
  console.log(`  Mint:   ${USDC_MINT_MAINNET.toBase58()} (USDC)`);

  const ataAddress = getAssociatedTokenAddressSync(
    USDC_MINT_MAINNET,
    exampleWallet,
    false, // allowOwnerOffCurve
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`  ATA:    ${ataAddress.toBase58()}`);
  console.log(
    "  → 동일한 (wallet, mint) 조합은 항상 동일한 ATA 주소를 반환"
  );

  // ATA의 데이터 구조
  console.log("\n[Token Account 데이터 구조 (165 bytes)]");
  console.log("  Offset  Size  Field");
  console.log("  ------  ----  -----");
  console.log("  0       32    mint");
  console.log("  32      32    owner");
  console.log("  64      8     amount (u64)");
  console.log("  72      4     delegateOption");
  console.log("  76      32    delegate");
  console.log("  108     1     state (0=uninitialized, 1=initialized, 2=frozen)");
  console.log("  109     4     isNativeOption");
  console.log("  113     8     isNative");
  console.log("  121     8     delegatedAmount");
  console.log("  129     4     closeAuthorityOption");
  console.log("  133     32    closeAuthority");
  console.log("  합계: 165 bytes");

  // Mainnet에서 실제 ATA 조회 시도
  const mainnetConnection = new Connection(
    clusterApiUrl("mainnet-beta"),
    "confirmed"
  );

  try {
    const accountInfo = await mainnetConnection.getAccountInfo(ataAddress);
    if (accountInfo && accountInfo.data.length === AccountLayout.span) {
      const decoded = AccountLayout.decode(accountInfo.data);
      console.log(`\n[ATA 실제 데이터 (mainnet)]`);
      console.log(
        `  mint:    ${new PublicKey(decoded.mint).toBase58()}`
      );
      console.log(
        `  owner:   ${new PublicKey(decoded.owner).toBase58()}`
      );
      console.log(`  amount:  ${decoded.amount.toString()}`);
      console.log(
        `  state:   ${decoded.state} (${decoded.state === 1 ? "initialized" : decoded.state === 2 ? "frozen" : "uninitialized"})`
      );
    } else {
      console.log(`\n  이 ATA는 아직 생성되지 않았습니다 (mainnet).`);
      console.log("  → 해당 지갑이 USDC를 받은 적이 없으면 ATA가 존재하지 않음");
    }
  } catch (err) {
    console.log(
      `  ATA 조회 실패: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================================
// 4. Rent-Exempt 보증금 계산
// ============================================================

async function exploreRentExemption(): Promise<void> {
  separator("4. Rent-Exempt 보증금 - 다양한 데이터 크기별 계산");

  console.log("\n[Rent-Exempt 계산 공식]");
  console.log(
    "  rent_exempt = (128 + data_size) * 6,960 lamports (근사값)"
  );
  console.log("  정확한 값은 getMinimumBalanceForRentExemption RPC로 조회\n");

  const dataSizes = [
    { name: "System Account (SOL 지갑)", bytes: 0 },
    { name: "Nonce Account", bytes: 80 },
    { name: "Token Mint", bytes: 82 },
    { name: "SPL Token Account (ATA)", bytes: 165 },
    { name: "Stake Account", bytes: 200 },
    { name: "Metaplex Metadata", bytes: 679 },
    { name: "1KB 데이터 계정", bytes: 1024 },
    { name: "10KB 데이터 계정", bytes: 10240 },
  ];

  // 테이블 헤더
  console.log(
    "  " +
      "계정 유형".padEnd(30) +
      "data 크기".padEnd(12) +
      "Lamports".padEnd(16) +
      "SOL".padEnd(14) +
      "근사값(공식)"
  );
  console.log("  " + "-".repeat(90));

  for (const { name, bytes } of dataSizes) {
    try {
      const rentExempt =
        await connection.getMinimumBalanceForRentExemption(bytes);
      const approximation = (128 + bytes) * 6960;
      const solAmount = rentExempt / LAMPORTS_PER_SOL;

      console.log(
        "  " +
          name.padEnd(30) +
          `${bytes} B`.padEnd(12) +
          `${rentExempt.toLocaleString()}`.padEnd(16) +
          `${solAmount.toFixed(6)}`.padEnd(14) +
          `${approximation.toLocaleString()}`
      );
    } catch (err) {
      console.log(`  ${name}: 조회 실패`);
    }
  }

  console.log("\n[참고]");
  console.log("  - 근사값(공식)은 RPC 응답과 거의 동일하지만 미세한 차이가 있을 수 있음");
  console.log("  - 프로덕션에서는 반드시 RPC 조회 값을 사용할 것");
  console.log(
    "  - Rent 보증금은 계정 close 시 100% 환불됨 (소멸이 아닌 보증금)"
  );
}

// ============================================================
// 5. PDA (Program Derived Address) 도출
// ============================================================

async function explorePDA(): Promise<void> {
  separator("5. PDA (Program Derived Address) 도출");

  console.log("\n[PDA 도출 원리]");
  console.log("  PDA = findProgramAddress(seeds[], programId)");
  console.log("  - SHA-256(seeds + programId + [bump])를 계산");
  console.log("  - bump를 255부터 0까지 줄이며 Ed25519 커브 밖의 점을 찾음");
  console.log("  - 커브 밖 = private key가 존재하지 않음 = 프로그램만 서명 가능");

  // 예시 1: ATA 주소 도출 (실제 ATA Program이 사용하는 방식)
  subSeparator("예시 1: ATA 주소 도출");

  const wallet = new PublicKey(
    "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"
  );
  const mint = USDC_MINT_MAINNET;

  const [ataPDA, ataBump] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`  seeds: [wallet, TOKEN_PROGRAM_ID, mint]`);
  console.log(`  programId: ASSOCIATED_TOKEN_PROGRAM_ID`);
  console.log(`  결과 PDA: ${ataPDA.toBase58()}`);
  console.log(`  bump:     ${ataBump}`);

  // getAssociatedTokenAddressSync 결과와 비교
  const ataFromHelper = getAssociatedTokenAddressSync(mint, wallet);
  console.log(
    `  헬퍼 결과: ${ataFromHelper.toBase58()}`
  );
  console.log(
    `  일치 여부: ${ataPDA.equals(ataFromHelper) ? "일치" : "불일치"}`
  );

  // 예시 2: 커스텀 PDA 도출
  subSeparator("예시 2: 커스텀 PDA (프로그램에서 사용하는 패턴)");

  const programId = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
  const userId = Buffer.from("user-12345");

  const [customPDA, customBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("user-settings"), userId],
    programId
  );

  console.log(`  seeds: ["user-settings", "user-12345"]`);
  console.log(`  programId: ${programId.toBase58()}`);
  console.log(`  결과 PDA: ${customPDA.toBase58()}`);
  console.log(`  bump:     ${customBump}`);

  // 예시 3: bump seed 역할 설명
  subSeparator("예시 3: bump seed의 역할");

  console.log("  bump는 255부터 시작하여 유효한 PDA를 찾을 때까지 감소:");
  console.log(`  이 경우 bump = ${customBump} → 255에서 ${255 - customBump}번 만에 발견`);
  console.log("  bump가 높을수록(255에 가까울수록) 도출 비용이 낮음");

  // 예시 4: 같은 seeds는 항상 같은 PDA
  subSeparator("예시 4: 결정론적 성질 검증");

  const [pda1] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from([1, 2, 3])],
    programId
  );
  const [pda2] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from([1, 2, 3])],
    programId
  );
  const [pda3] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from([1, 2, 4])], // 다른 seed
    programId
  );

  console.log(`  동일 seeds:   ${pda1.toBase58()}`);
  console.log(`  동일 seeds:   ${pda2.toBase58()}`);
  console.log(`  다른 seeds:   ${pda3.toBase58()}`);
  console.log(`  pda1 == pda2: ${pda1.equals(pda2)}`);
  console.log(`  pda1 == pda3: ${pda1.equals(pda3)}`);
}

// ============================================================
// 6. 계정 유형별 차이 비교
// ============================================================

async function compareAccountTypes(): Promise<void> {
  separator("6. 계정 유형별 차이 비교");

  // Program Account 조회 (Token Program)
  subSeparator("Program Account (Token Program)");
  const tokenProgramInfo = await connection.getAccountInfo(TOKEN_PROGRAM_ID);
  if (tokenProgramInfo) {
    console.log(
      `  주소:       ${TOKEN_PROGRAM_ID.toBase58()}`
    );
    console.log(`  executable: ${tokenProgramInfo.executable} ← 프로그램이므로 true`);
    console.log(`  owner:      ${tokenProgramInfo.owner.toBase58()}`);
    console.log(`  data 크기:  ${tokenProgramInfo.data.length} bytes (BPF 바이트코드)`);
    console.log(
      `  lamports:   ${tokenProgramInfo.lamports} (${(tokenProgramInfo.lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL)`
    );
  }

  // System Program 조회
  subSeparator("System Program");
  const systemProgramInfo = await connection.getAccountInfo(SYSTEM_PROGRAM_ID);
  if (systemProgramInfo) {
    console.log(
      `  주소:       ${SYSTEM_PROGRAM_ID.toBase58()}`
    );
    console.log(`  executable: ${systemProgramInfo.executable}`);
    console.log(`  owner:      ${systemProgramInfo.owner.toBase58()}`);
    console.log(`  data 크기:  ${systemProgramInfo.data.length} bytes`);
    console.log(
      `  lamports:   ${systemProgramInfo.lamports} (${(systemProgramInfo.lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL)`
    );
  }

  // 비교 테이블
  subSeparator("계정 유형 비교 요약");
  console.log(`
  | 계정 유형          | data 크기  | executable | owner            | 용도                |
  |-------------------|-----------|------------|------------------|-------------------|
  | System Account    | 0 bytes   | false      | System Program   | SOL 보유 (지갑)     |
  | Token Account     | 165 bytes | false      | Token Program    | SPL Token 잔액     |
  | Mint Account      | 82 bytes  | false      | Token Program    | 토큰 정의 (메타)    |
  | Program Account   | ~수KB     | true       | BPF Loader       | 실행 가능한 코드     |
  | Nonce Account     | 80 bytes  | false      | System Program   | Durable Nonce      |
  | PDA Account       | 가변      | false      | 생성 프로그램       | 프로그램 데이터 저장  |
  `);

  console.log("\n[EVM 대비 핵심 차이]");
  console.log(
    "  EVM: 컨트랙트 = 코드 + 상태가 하나의 주소에 존재"
  );
  console.log(
    "  Solana: 프로그램(코드)과 데이터 계정(상태)이 별도 주소에 분리"
  );
  console.log(
    "  → Solana는 어떤 계정을 읽고/쓰는지 TX에 명시하므로 병렬 실행 가능"
  );
  console.log(
    "  → EVM은 실행해봐야 storage 접근 패턴을 알 수 있으므로 순차 실행"
  );
}

// ============================================================
// 메인 실행
// ============================================================

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Solana Account Explorer (Devnet/Mainnet)       ║");
  console.log("║  다양한 계정 유형을 조회하고 Solana 계정 모델을 학습합니다  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const devnetVersion = await connection.getVersion();
  console.log(`\nDevnet RPC 연결 성공 (solana-core: ${devnetVersion["solana-core"]})`);

  try {
    await exploreSystemAccount();
    await exploreMintAccount();
    await exploreATA();
    await exploreRentExemption();
    await explorePDA();
    await compareAccountTypes();

    separator("완료");
    console.log("\n  모든 탐색이 완료되었습니다.");
    console.log("  이 스크립트에서 확인한 핵심 개념:");
    console.log("    1. 모든 Solana 데이터는 Account에 저장됨 (5가지 필드)");
    console.log(
      "    2. owner 프로그램만 data를 수정 가능 (보안 모델의 핵심)"
    );
    console.log(
      "    3. Rent-exempt 보증금은 데이터 크기에 비례, close 시 환불"
    );
    console.log(
      "    4. PDA는 결정적 주소 도출 → ATA, 프로그램 데이터 계정 등에 활용"
    );
    console.log(
      "    5. 프로그램(executable=true)과 데이터 계정(executable=false)이 분리됨"
    );
    console.log("");
  } catch (err) {
    console.error("\n오류 발생:", err instanceof Error ? err.message : String(err));
    console.error(
      "devnet/mainnet RPC에 접근할 수 없는 경우 네트워크 연결을 확인하세요."
    );
    process.exit(1);
  }
}

main();
