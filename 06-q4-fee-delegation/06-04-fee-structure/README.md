# 6.4 Fee 구조 상세

상위 섹션: [6. Q4: Fee Delegation](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**기본 수수료:**
- TX당 5,000 lamports (서명 1개당) ≈ $0.001 (@$200/SOL)
- 50% 소각, 50% validator에게 지급
**Priority Fee (선택):**
prioritization_fee = ceil(compute_unit_price * compute_unit_limit / 1,000,000) lamports
예시:
  compute_unit_price = 1,000 micro-lamports
  compute_unit_limit = 200,000 CU
  priority_fee = ceil(1000 * 200000 / 1000000) = 200 lamports ≈ $0.00004
**Compute Unit 한도:**
- 명령어당 기본: 200,000 CU
- TX당 최대: 1,400,000 CU
- 빌트인 명령어: 3,000 CU
**로컬 Fee 시장:**
- EVM과 달리 Solana는 프로그램별 독립적 fee 시장
- 관련 없는 프로그램의 트래픽이 우리 TX의 fee에 영향 없음
---

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
