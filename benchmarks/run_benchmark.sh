#!/usr/bin/env bash
# =============================================================================
# supabase-skill Benchmark Runner
# Compares task completion with supabase-skill CLI vs raw Supabase MCP tools
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METADATA="$SCRIPT_DIR/eval_metadata.json"
PROJECT_DIR="/home/matt/bibleai"

WITH_DIR="$SCRIPT_DIR/with_skill"
WITHOUT_DIR="$SCRIPT_DIR/without_skill"
GRADING_DIR="$SCRIPT_DIR/grading"
RESULTS_JSON="$SCRIPT_DIR/benchmark.json"
RESULTS_MD="$SCRIPT_DIR/benchmark.md"

MODEL="${1:-sonnet}"
RUNS_PER_EVAL=3
WITH_MAX_TURNS=5
WITHOUT_MAX_TURNS=10

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Ensure directories exist
mkdir -p "$WITH_DIR" "$WITHOUT_DIR" "$GRADING_DIR"

# Check dependencies
if ! command -v claude &>/dev/null; then
  echo -e "${RED}Error: 'claude' CLI not found${NC}"
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo -e "${RED}Error: 'jq' not found${NC}"
  exit 1
fi

# =============================================================================
# Helper: run a single eval and capture output + timing
# =============================================================================
run_eval() {
  local prompt="$1"
  local output_file="$2"
  local max_turns="$3"
  local allowed_tools="$4"

  local start_time end_time duration

  start_time=$(date +%s%3N)

  if [[ -n "$allowed_tools" ]]; then
    cd "$PROJECT_DIR" && claude -p "$prompt" \
      --allowedTools "$allowed_tools" \
      --model "$MODEL" \
      --max-turns "$max_turns" \
      > "$output_file" 2>&1 || true
  else
    cd "$PROJECT_DIR" && claude -p "$prompt" \
      --model "$MODEL" \
      --max-turns "$max_turns" \
      > "$output_file" 2>&1 || true
  fi

  end_time=$(date +%s%3N)
  duration=$(( end_time - start_time ))
  echo "$duration"
}

# =============================================================================
# Helper: grade a single response
# =============================================================================
grade_response() {
  local eval_id="$1"
  local response_file="$2"
  local assertions_json="$3"
  local grade_file="$4"

  local response
  response=$(cat "$response_file")

  local grade_prompt
  grade_prompt=$(cat <<GRADEEOF
Grade this AI response for completeness and accuracy.

Task ID: ${eval_id}

Required assertions (response must contain ALL of these, case-insensitive):
${assertions_json}

Response to grade:
---
${response}
---

Return ONLY a JSON object with these fields:
{
  "pass": true/false,
  "assertions_met": ["list of matched assertions"],
  "assertions_missed": ["list of missed assertions"],
  "quality_score": 1-5 (1=wrong, 2=partial, 3=adequate, 4=good, 5=excellent),
  "notes": "brief explanation"
}
GRADEEOF
)

  claude -p "$grade_prompt" \
    --model "$MODEL" \
    --max-turns 1 \
    > "$grade_file" 2>&1 || true
}

# =============================================================================
# Main benchmark loop
# =============================================================================
echo "=============================================="
echo " supabase-skill Benchmark"
echo " Model: $MODEL"
echo " Runs per eval: $RUNS_PER_EVAL"
echo "=============================================="
echo ""

EVAL_COUNT=$(jq '.evals | length' "$METADATA")
echo -e "${GREEN}Found $EVAL_COUNT evals${NC}"
echo ""

# ---- Phase 1: Run with_skill evals ----
echo "====== Phase 1: WITH supabase-skill ======"
for (( i=0; i<EVAL_COUNT; i++ )); do
  eval_id=$(jq -r ".evals[$i].id" "$METADATA")
  with_prompt=$(jq -r ".evals[$i].with_skill_prompt" "$METADATA")

  for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
    output_file="$WITH_DIR/${eval_id}_run${run}.txt"
    echo -ne "  [with_skill] ${eval_id} run ${run}/${RUNS_PER_EVAL} ... "

    duration=$(run_eval "$with_prompt" "$output_file" "$WITH_MAX_TURNS" 'Bash(supabase-skill *)')

    echo -e "${GREEN}done${NC} (${duration}ms)"

    # Store timing metadata
    echo "$duration" > "$WITH_DIR/${eval_id}_run${run}.time"
  done
done

echo ""

# ---- Phase 2: Run without_skill evals ----
echo "====== Phase 2: WITHOUT supabase-skill (MCP only) ======"
for (( i=0; i<EVAL_COUNT; i++ )); do
  eval_id=$(jq -r ".evals[$i].id" "$METADATA")
  without_prompt=$(jq -r ".evals[$i].without_skill_prompt" "$METADATA")

  for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
    output_file="$WITHOUT_DIR/${eval_id}_run${run}.txt"
    echo -ne "  [without_skill] ${eval_id} run ${run}/${RUNS_PER_EVAL} ... "

    duration=$(run_eval "$without_prompt" "$output_file" "$WITHOUT_MAX_TURNS" "")

    echo -e "${GREEN}done${NC} (${duration}ms)"

    echo "$duration" > "$WITHOUT_DIR/${eval_id}_run${run}.time"
  done
done

echo ""

# ---- Phase 3: Grade all responses ----
echo "====== Phase 3: Grading ======"
for (( i=0; i<EVAL_COUNT; i++ )); do
  eval_id=$(jq -r ".evals[$i].id" "$METADATA")
  assertions=$(jq -c ".evals[$i].assertions" "$METADATA")

  for group in "with_skill" "without_skill"; do
    if [[ "$group" == "with_skill" ]]; then
      dir="$WITH_DIR"
    else
      dir="$WITHOUT_DIR"
    fi

    for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
      response_file="$dir/${eval_id}_run${run}.txt"
      grade_file="$GRADING_DIR/${group}_${eval_id}_run${run}.json"

      if [[ ! -f "$response_file" ]]; then
        echo -e "  ${RED}SKIP${NC} $group/${eval_id} run ${run} (no response file)"
        continue
      fi

      echo -ne "  [grade] ${group}/${eval_id} run ${run} ... "
      grade_response "$eval_id" "$response_file" "$assertions" "$grade_file"
      echo -e "${GREEN}done${NC}"
    done
  done
done

echo ""

# ---- Phase 4: Aggregate results ----
echo "====== Phase 4: Aggregating Results ======"

# Build results JSON
results_json='{"skill":"supabase-skill","model":"'"$MODEL"'","runs_per_eval":'"$RUNS_PER_EVAL"',"timestamp":"'"$(date -Iseconds)"'","evals":[]}'

for (( i=0; i<EVAL_COUNT; i++ )); do
  eval_id=$(jq -r ".evals[$i].id" "$METADATA")
  task=$(jq -r ".evals[$i].task" "$METADATA")

  # Collect with_skill times
  with_times=()
  for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
    time_file="$WITH_DIR/${eval_id}_run${run}.time"
    if [[ -f "$time_file" ]]; then
      with_times+=($(cat "$time_file"))
    fi
  done

  # Collect without_skill times
  without_times=()
  for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
    time_file="$WITHOUT_DIR/${eval_id}_run${run}.time"
    if [[ -f "$time_file" ]]; then
      without_times+=($(cat "$time_file"))
    fi
  done

  # Calculate averages
  with_avg=0
  if (( ${#with_times[@]} > 0 )); then
    with_sum=0
    for t in "${with_times[@]}"; do with_sum=$((with_sum + t)); done
    with_avg=$((with_sum / ${#with_times[@]}))
  fi

  without_avg=0
  if (( ${#without_times[@]} > 0 )); then
    without_sum=0
    for t in "${without_times[@]}"; do without_sum=$((without_sum + t)); done
    without_avg=$((without_sum / ${#without_times[@]}))
  fi

  # Collect grade scores
  with_scores=()
  without_scores=()
  with_pass=0
  without_pass=0

  for (( run=1; run<=RUNS_PER_EVAL; run++ )); do
    grade_file="$GRADING_DIR/with_skill_${eval_id}_run${run}.json"
    if [[ -f "$grade_file" ]]; then
      score=$(jq -r '.quality_score // 0' "$grade_file" 2>/dev/null || echo "0")
      pass=$(jq -r '.pass // false' "$grade_file" 2>/dev/null || echo "false")
      with_scores+=("$score")
      [[ "$pass" == "true" ]] && with_pass=$((with_pass + 1))
    fi

    grade_file="$GRADING_DIR/without_skill_${eval_id}_run${run}.json"
    if [[ -f "$grade_file" ]]; then
      score=$(jq -r '.quality_score // 0' "$grade_file" 2>/dev/null || echo "0")
      pass=$(jq -r '.pass // false' "$grade_file" 2>/dev/null || echo "false")
      without_scores+=("$score")
      [[ "$pass" == "true" ]] && without_pass=$((without_pass + 1))
    fi
  done

  # Build eval entry
  eval_entry=$(jq -n \
    --arg id "$eval_id" \
    --arg task "$task" \
    --argjson with_avg "$with_avg" \
    --argjson without_avg "$without_avg" \
    --argjson with_pass "$with_pass" \
    --argjson without_pass "$without_pass" \
    --argjson runs "$RUNS_PER_EVAL" \
    '{
      id: $id,
      task: $task,
      with_skill: { avg_ms: $with_avg, pass_rate: "\($with_pass)/\($runs)" },
      without_skill: { avg_ms: $without_avg, pass_rate: "\($without_pass)/\($runs)" },
      speedup: (if $without_avg > 0 and $with_avg > 0 then (($without_avg / $with_avg * 100 | floor) / 100) else null end)
    }')

  results_json=$(echo "$results_json" | jq --argjson entry "$eval_entry" '.evals += [$entry]')
done

echo "$results_json" | jq '.' > "$RESULTS_JSON"
echo -e "${GREEN}Results written to $RESULTS_JSON${NC}"

# ---- Phase 5: Generate markdown report ----
echo ""
echo "====== Phase 5: Generating Report ======"

{
  echo "# supabase-skill Benchmark Results"
  echo ""
  echo "**Model:** $MODEL"
  echo "**Runs per eval:** $RUNS_PER_EVAL"
  echo "**Date:** $(date '+%Y-%m-%d %H:%M')"
  echo ""
  echo "## Summary"
  echo ""
  echo "| Eval | Task | With Skill (avg ms) | Without Skill (avg ms) | Speedup | With Pass | Without Pass |"
  echo "|------|------|---------------------|----------------------|---------|-----------|--------------|"

  for (( i=0; i<EVAL_COUNT; i++ )); do
    eval_id=$(jq -r ".evals[$i].id" "$RESULTS_JSON")
    task=$(jq -r ".evals[$i].task" "$RESULTS_JSON")
    with_ms=$(jq -r ".evals[$i].with_skill.avg_ms" "$RESULTS_JSON")
    without_ms=$(jq -r ".evals[$i].without_skill.avg_ms" "$RESULTS_JSON")
    speedup=$(jq -r ".evals[$i].speedup // \"N/A\"" "$RESULTS_JSON")
    with_pass=$(jq -r ".evals[$i].with_skill.pass_rate" "$RESULTS_JSON")
    without_pass=$(jq -r ".evals[$i].without_skill.pass_rate" "$RESULTS_JSON")

    # Truncate task for table
    short_task="${task:0:50}"
    [[ ${#task} -gt 50 ]] && short_task="${short_task}..."

    echo "| $eval_id | $short_task | ${with_ms}ms | ${without_ms}ms | ${speedup}x | $with_pass | $without_pass |"
  done

  echo ""
  echo "## Raw Data"
  echo ""
  echo "See \`benchmark.json\` for full results."
  echo ""
  echo "Individual responses in \`with_skill/\` and \`without_skill/\` directories."
  echo ""
  echo "Grading details in \`grading/\` directory."
} > "$RESULTS_MD"

echo -e "${GREEN}Report written to $RESULTS_MD${NC}"
echo ""
echo "=============================================="
echo -e "${GREEN} Benchmark complete!${NC}"
echo "=============================================="
