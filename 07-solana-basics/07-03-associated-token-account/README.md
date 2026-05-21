# 7.3 Associated Token Account (ATA)

상위 섹션: [7. Solana 기초 개념 상세](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

EVM에서는 어떤 주소든 ERC20 토큰을 받을 수 있지만, Solana에서는 **토큰별로 전용 계정이 필요**하다.
ATA 주소 도출:
PDA = findProgramAddress(
  [wallet_address, TOKEN_PROGRAM_ID, mint_address],
  ASSOCIATED_TOKEN_PROGRAM_ID
)
예시:
  유저 지갑: 7Np41...
  USDC mint: EPjFW...
  → ATA: 3xnB7... (결정적 도출, 유니크)
**ATA 생성 시점:**
- 최초 토큰 수신 전에 생성 필요
- `createAssociatedTokenAccountIdempotent` 사용 (이미 존재하면 무시)
- 생성 비용: ~0.00204 SOL (fee payer가 부담)
- Lazy 생성 권장: 해당 토큰을 처음 사용할 때 생성

## 개발할 내용

1. fee payer/ATA/rent-exempt 처리 로직과 모니터링 항목을 설계한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. fee payer account ordering, rent, SPL Token/ATA lifecycle을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. ATA 없는 수신자에게 idempotent create + transfer를 devnet에서 검증한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
