# Solana Devnet 실습 예제

Dagaon Core (EVM 기반 커스터디얼 지갑)의 Solana 통합을 위한 실습 코드.
각 예제는 EVM과의 차이를 설명하며, 순서대로 실행해야 한다.

## 실행 방법

```bash
cd examples
npm install
npm run 01  # 계정 생성
npm run 02  # SOL airdrop
npm run 03  # SPL 토큰 생성
npm run 04  # SOL 전송
npm run 05  # SPL 토큰 전송
npm run 06  # Fee Payer 지정
npm run 07  # TX 모니터링 + 블록 파싱
```

## 예제 목록

| # | 파일 | 내용 | Dagaon Core 대응 |
|---|------|------|-----------------|
| 01 | `01-create-accounts.ts` | Ed25519 키페어 생성, base58 주소 | KMS 키 생성 |
| 02 | `02-airdrop-sol.ts` | devnet SOL faucet | - |
| 03 | `03-create-spl-token.ts` | Mint 생성, ATA 생성, 토큰 민팅 | token_contracts 관리 |
| 04 | `04-transfer-sol.ts` | Native SOL 전송 + TX 분석 | tx-sender (native) |
| 05 | `05-transfer-spl-token.ts` | SPL 토큰 전송 (고수준/저수준) | tx-sender (token) |
| 06 | `06-fee-payer.ts` | 수수료 대납 (gasless tx) | fee delegation |
| 07 | `07-monitor-tx.ts` | TX 확인 + 블록 파싱 + 주소 히스토리 | Publisher/Consumer/Confirmer |

## 키 파일

`.keys/` 디렉토리에 생성됨 (gitignore됨):
- `main-wallet.json` - 메인 테스트 지갑
- `receiver.json` - 수신 테스트 지갑
- `fee-payer.json` - 수수료 대납 지갑
- `token-mint.json` - 생성한 SPL 토큰 mint 주소
