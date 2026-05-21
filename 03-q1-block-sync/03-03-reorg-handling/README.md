# 3.3 Reorg 처리

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)
원문: ../../solana-integration-research.md

## 원문 핵심 발췌

**EVM:** parentHash를 RingBuffer에 저장하여 체인 연속성 검증. 불일치 시 fork point까지 되돌림.
**Solana:**
- `finalized` commitment에서 reorg가 관측된 적 없음
- 블록에 `previousBlockhash` 필드가 있어 RingBuffer 검증은 기술적으로 가능
- **방어적 구현:** RingBuffer를 유지하되, 실제로 트리거될 일은 없음
**Commitment Level별 reorg 리스크:**
| Level | 지연 시간 | Reorg 리스크 | 용도 |
|-------|----------|-------------|------|
| `processed` | ~400ms | 있음 (약 5% fork rate) | 개발/테스트용. **입금에 절대 사용 금지** |
| `confirmed` | ~600ms | 이론적으로 가능, 실제 관측된 적 없음 | 잔액 표시, 비핵심 UI |
| `finalized` | ~13s | 불가능 (경제적으로 비실현적) | **입금 확정에 사용** |

## 개발할 내용

1. slot scanner와 transfer extractor 테스트 fixture를 만든다.
2. 이 항목이 상위 파이프라인에서 들어갈 정확한 컴포넌트와 입력/출력 DTO를 적는다.
3. 실패 케이스, 재시도, idempotency, 모니터링 포인트를 최소 1개 이상 정의한다.

## 공부할 내용

1. slot/blockHeight/commitment/finality 및 balance diff 추출 방식을 학습한다.
2. EVM 현재 구현의 대응 개념과 차이점을 한 문단으로 비교한다.
3. 문서 내용이 실제 RPC/SDK 응답과 맞는지 샘플로 확인한다.

## 실습/검증 과제

1. 최근 finalized slot block JSON을 받아 SOL/SPL transfer를 수작업 검증한다.
2. fixture 또는 명령 실행 결과를 이 폴더에 `notes.md`나 `fixtures/`로 남긴다.
3. 구현 전에 acceptance criteria 3개를 체크박스로 작성한다.

## 완료 기준

- 개념 설명, 구현 위치, 테스트/검증 방법이 모두 문서화되어 있다.
- 공식 문서 링크나 실제 devnet/mainnet 응답 중 하나로 가정을 확인했다.
- 상위 섹션 README의 완료 기준을 충족하는 데 기여한다.
