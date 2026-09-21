from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class GroundingPolicy:
    """Prevents hallucination: every factual answer must have a trusted source."""
    require_source: bool = True
    allow_uncertain_answers: bool = True
    max_hallucination_risk: float = 0.0

    def validate(self, answer: str, sources: List[str]) -> Dict[str, Any]:
        evidence = [source for source in sources if source and str(source).strip()]
        if not self.require_source:
            return {"status": "ok", "grounded": True, "reason": "source check disabled"}

        if not evidence:
            return {
                "status": "blocked",
                "grounded": False,
                "reason": "No trusted source or evidence is available for the answer.",
                "safe_response": "لا أستطيع تأكيد هذه المعلومة بدون مصدر موثوق. أستطيع أن أشرح ما هو معروف أو أطلب توضيحاً.",
            }

        return {"status": "ok", "grounded": True, "reason": "source available", "sources": evidence}


@dataclass
class ToolCard:
    name: str
    description: str
    kind: str
    route: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentWorkflow:
    """Operational pipeline for a capable assistant agent."""
    stages: List[str] = field(
        default_factory=lambda: [
            "analyze_request",
            "retrieve_sources",
            "route_tools",
            "plan_execution",
            "execute_action",
            "verify_results",
            "respond_with_evidence",
        ]
    )

    def describe(self) -> Dict[str, Any]:
        return {
            "stages": self.stages,
            "objective": "Answer, act, and verify using grounded evidence and safe tool usage.",
        }


class AgentPolicy:
    """High-level architecture for Suras as a grounded, tool-using agent."""

    def __init__(self) -> None:
        self.grounding = GroundingPolicy()
        self.workflow = AgentWorkflow()
        self.tools: List[ToolCard] = [
            ToolCard("search", "Search knowledge base and external documents", "retrieval", "knowledge.search"),
            ToolCard("api", "Query structured APIs and services", "integration", "api.call"),
            ToolCard("terminal", "Execute local actions and commands", "execution", "system.run"),
            ToolCard("planner", "Break tasks into steps and execution plan", "reasoning", "planner.create"),
            ToolCard("review", "Verify correctness before responding", "verification", "response.review"),
        ]

    def route(self, user_request: str) -> Dict[str, Any]:
        request = user_request.strip()
        if not request:
            return {"status": "blocked", "reason": "empty request"}

        return {
            "status": "ready",
            "request": request,
            "workflow": self.workflow.describe(),
            "tools": [tool.name for tool in self.tools],
            "grounding_required": self.grounding.require_source,
        }

    def plan(self, user_request: str, sources: Optional[List[str]] = None) -> Dict[str, Any]:
        grounding = self.grounding.validate(user_request, sources or [])
        if grounding["status"] == "blocked":
            return {"status": "blocked", "reason": grounding["safe_response"]}

        return {
            "status": "ok",
            "plan": [
                "Analyze task intent",
                "Select relevant tools",
                "Gather source-backed evidence",
                "Perform action or answer",
                "Review final output against evidence",
            ],
            "grounding": grounding,
        }


if __name__ == "__main__":
    policy = AgentPolicy()
    print(policy.route("كيف أضع نظاما ذكياً مع أدوات بحث وقاعدة معرفة؟"))
    print(policy.plan("كيف أضع نظاما ذكياً مع أدوات بحث وقاعدة معرفة؟", ["internal_knowledge_base", "web_search_result"]))
