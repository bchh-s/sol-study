# ADR-1: 입금 Commitment Level

상위 섹션: [12. Architecture Decision Records](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**결정:** `finalized` commitment만 사용하여 입금 확정
**근거:**
- Reorg 리스크 완전 제거
- ~13초 지연은 EVM의 15 confirmation (3-5분)보다 오히려 빠름
- Event Confirmer 단계 제거로 파이프라인 단순화
**Trade-off:** `confirmed` 대비 약 12초 추가 지연. 수용 가능.

## 개발할 내용

1. ADR 파일로 분리하고 반대안/근거/결과를 보강한다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. ADR 형식과 관련 공식 문서 근거를 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 리뷰 체크리스트로 decision quality를 검증한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
