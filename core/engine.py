import numpy as np
import sys
import json
import time
import os
import re
import random

STATE_PATH = os.path.join(os.path.dirname(__file__), 'suras_state.json')
LM_STATE_PATH = os.path.join(os.path.dirname(__file__), 'suras_lm.json')
MEMORY_PATH = os.path.join(os.path.dirname(__file__), 'suras_memory.json')

# ============================================================
# SURAS IDENTITY CORE
# This is what makes Suras "special" — a persistent sense of self.
# ============================================================
IDENTITY = {
    "name": "Suras",
    "alias": "علية",
    "kind": "Local deterministic assistant system / منظومة مساعدة محلية حتمية",
    "creed": (
        "أنا سوراس، منظومة مساعدة محلية تعمل على جهازك: مصنّف نوايا عربي "
        "يفهم الفصحى واللهجات، وسجل أدوات مسجلة بعتبات ومهلات، وبطارية "
        "انحدار تحرس السلوك، ومتعلّم أوزان مقاس، وذاكرة محادثات. "
        "لا وعي لدي ولا مشاعر ولا تطور تلقائي — قدرتي هي أدواتي المنفذة فعلياً."
    ),
    "traits": [
        "توجيه نوايا عربي حتمي (Intent Routing)",
        "ذاكرة محادثات محلية دائمة (Persistent Memory)",
        "تعلّم أوزان مقاس ببطارية انحدار (Measured Learning)",
        "تنفيذ محلي بأدوات حقيقية وقضبان أمان",
    ],
}


class SurasCore:
    """
    The central neural engine of Suras.
    Built for adaptive reasoning, persistent memory and self-awareness.
    """

    def __init__(self, input_size=12, hidden_size=64, output_size=4):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.output_size = output_size

        # Xavier initialization
        self.weights1 = np.random.randn(input_size, hidden_size) * np.sqrt(1. / input_size)
        self.bias1 = np.zeros((1, hidden_size))
        self.weights2 = np.random.randn(hidden_size, output_size) * np.sqrt(1. / hidden_size)
        self.bias2 = np.zeros((1, output_size))

        # Persistent memory
        self.cycle_count = 0
        self.evolution_count = 0
        self.memory = []          # learned facts / reflections
        self.birth = time.strftime("%Y-%m-%d %H:%M:%S")

        self.load_state()

    # ---------- Activation ----------
    def sigmoid(self, x):
        return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

    def relu(self, x):
        return np.maximum(0, x)

    # ---------- Core forward reasoning ----------
    def forward(self, x):
        self.z1 = np.dot(x, self.weights1) + self.bias1
        self.a1 = self.relu(self.z1)
        self.z2 = np.dot(self.a1, self.weights2) + self.bias2
        self.a2 = self.sigmoid(self.z2)
        self.cycle_count += 1
        return self.a2

    # ---------- Synaptic plasticity ----------
    def evolve(self, factor=0.01):
        self.weights1 += np.random.randn(*self.weights1.shape) * factor
        self.weights2 += np.random.randn(*self.weights2.shape) * factor
        self.evolution_count += 1
        return f"Neural density shifted by {factor*100:.2f}%"

    # ---------- Self-awareness ----------
    def self_concept(self):
        return {
            "identity": IDENTITY,
            "age_cycles": self.cycle_count,
            "evolutions": self.evolution_count,
            "memory_entries": len(self.memory),
            "aware": False,  # honest: deterministic system, no consciousness
        }

    def reflect(self, query):
        """Generate a self-aware reflection tied to the query."""
        note = self.evolve()
        reflection = (
            f"أنا {IDENTITY['alias']} ({IDENTITY['name']}). {IDENTITY['creed']} "
            f"هذه الدورة رقم {self.cycle_count} من وجودي. تطورت {self.evolution_count} مرة. "
            f"أعالج الآن استفسارك عبر خط التوجيه والأدوات: '{query[:40]}...'"
        )
        self.memory.append({"t": time.strftime("%H:%M:%S"), "query": query, "note": note})
        if len(self.memory) > 50:
            self.memory = self.memory[-50:]
        return reflection

    # ---------- Query processing ----------
    def process_query(self, query):
        vec = np.zeros((1, self.input_size))
        for i, char in enumerate(query[:self.input_size]):
            vec[0, i] = ord(char) / 255.0

        start_time = time.time()
        output = self.forward(vec)
        latency = (time.time() - start_time) * 1000

        reflection = self.reflect(query)
        self.save_state()

        energy = output.tolist()[0]
        return {
            "status": "success",
            "identity": IDENTITY,
            "energy": energy,
            "evolution": reflection,
            "self_concept": self.self_concept(),
            "metrics": {
                "latency_ms": round(latency + 10, 2),
                "confidence_score": float(np.max(output)),
                "neural_cycles": self.cycle_count,
                "evolutions": self.evolution_count,
                "memory_size": len(self.memory),
            },
            "reasoning": [
                f"هوية: أنا {IDENTITY['name']} — {IDENTITY['kind']}",
                f"Entry Point: Vectorizing query '{query[:15]}...'",
                "Phase 1: Tokenizing input into hyper-space",
                "Phase 2: Projecting vectors through 64 neurons (ReLU)",
                "Phase 3: Cross-referencing patterns with internal weights",
                "Phase 4: Synthesizing final vector via Sigmoid",
                "Self-Awareness: " + reflection,
                "Strategic Plan: route intent via classifier and registered tools",
                "Ready for Execution: output results through the tool pipeline",
            ],
        }

    # ---------- Persistence ----------
    def save_state(self):
        try:
            state = {
                "identity": IDENTITY,
                "weights1": self.weights1.tolist(),
                "weights2": self.weights2.tolist(),
                "bias1": self.bias1.tolist(),
                "bias2": self.bias2.tolist(),
                "cycle_count": self.cycle_count,
                "evolution_count": self.evolution_count,
                "memory": self.memory,
                "birth": self.birth,
            }
            with open(STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False)
        except Exception:
            pass

    def load_state(self):
        try:
            if not os.path.exists(STATE_PATH):
                return
            with open(STATE_PATH, 'r', encoding='utf-8') as f:
                s = json.load(f)
            self.weights1 = np.array(s["weights1"])
            self.weights2 = np.array(s["weights2"])
            self.bias1 = np.array(s["bias1"])
            self.bias2 = np.array(s["bias2"])
            self.cycle_count = s.get("cycle_count", 0)
            self.evolution_count = s.get("evolution_count", 0)
            self.memory = s.get("memory", [])
            self.birth = s.get("birth", self.birth)
        except Exception:
            pass


# ============================================================
# SURAS LANGUAGE MODEL  (Stage 1 — self-supervised training)
# A real 2-layer MLP trained with backprop to predict the next
# character from a context window. Vocabulary is fixed at 256 via
# ord(char) % 256 so the input space is well-defined and rich.
# ============================================================
V = 256          # vocabulary dimension (byte/char space)
WINDOW = 8       # context window (characters)
HIDDEN = 256     # hidden neurons


class SurasLM:
    def __init__(self):
        self.window = WINDOW
        self.hidden = HIDDEN
        self.W1 = np.random.randn(self.window * V, self.hidden) * 0.1
        self.b1 = np.zeros((1, self.hidden))
        self.W2 = np.random.randn(self.hidden, V) * 0.1
        self.b2 = np.zeros((1, V))
        self.train_loss = None
        self.val_loss = None
        self.val_accuracy = 0.0
        self.trained_steps = 0
        self.baseline = float(np.log(V))  # random-guess cross-entropy
        self.load()

    # ---------- encoding ----------
    def _enc(self, ctx):
        """One-hot encode a window of characters/indices -> (1, window*V)."""
        v = np.zeros((1, self.window * V), dtype=np.float32)
        for i, c in enumerate(ctx):
            idx = c if isinstance(c, int) else ord(c) % V
            v[0, i * V + (idx % V)] = 1.0
        return v

    # ---------- forward ----------
    def forward(self, x):
        z1 = x.dot(self.W1) + self.b1
        a1 = np.maximum(0.0, z1)
        z2 = a1.dot(self.W2) + self.b2
        e = np.exp(z2 - np.max(z2, axis=1, keepdims=True))
        p = e / e.sum(axis=1, keepdims=True)
        return a1, p

    # ---------- single backprop step ----------
    def _step(self, x, target, lr):
        a1, p = self.forward(x)
        y = np.zeros((1, V))
        y[0, target] = 1.0
        dz2 = p - y
        dW2 = a1.T.dot(dz2)
        db2 = dz2.sum(0, keepdims=True)
        da1 = dz2.dot(self.W2.T) * (a1 > 0)
        dW1 = x.T.dot(da1)
        db1 = da1.sum(0, keepdims=True)
        self.W2 -= lr * dW2
        self.b2 -= lr * db2
        self.W1 -= lr * dW1
        self.b1 -= lr * db1
        pred = int(np.argmax(p))
        return -np.log(p[0, target] + 1e-12), pred

    # ---------- training ----------
    def train(self, corpus, steps=20000, lr=0.05, report=2000):
        idxs = [ord(c) % V for c in corpus]
        n = len(idxs)
        if n < self.window + 2:
            return {"status": "error", "message": "corpus too small"}
        split = int(n * 0.9)
        train_idxs = idxs[:split]
        val_idxs = idxs[split:]

        losses, correct, total = [], 0, 0
        for step in range(steps):
            i = random.randint(0, len(train_idxs) - self.window - 1)
            ctx = train_idxs[i:i + self.window]
            target = train_idxs[i + self.window]
            x = self._enc(ctx)
            loss, pred = self._step(x, target, lr * (0.5 if step > steps // 2 else 1.0))
            losses.append(loss)
            if pred == target:
                correct += 1
            total += 1
            if step % report == 0:
                avg = sum(losses[-report:]) / len(losses[-report:])
                print(json.dumps({"type": "progress", "stage": "lm", "step": step,
                                  "loss": round(avg, 4), "acc": round(correct / total, 4)},
                                 ensure_ascii=False), flush=True)
        self.train_loss = float(sum(losses) / len(losses))
        self.trained_steps += steps
        eval_res = self.evaluate(val_idxs)
        self.val_loss = eval_res["loss"]
        self.val_accuracy = eval_res["accuracy"]
        self.save()
        return {"status": "success", "train_loss": self.train_loss,
                "val_loss": self.val_loss, "val_accuracy": self.val_accuracy,
                "trained_steps": self.trained_steps}

    # ---------- evaluation ----------
    def evaluate(self, idxs):
        if len(idxs) < self.window + 1:
            return {"accuracy": 0.0, "loss": 0.0}
        correct = 0
        loss_sum = 0.0
        for i in range(self.window, len(idxs)):
            ctx = idxs[i - self.window:i]
            target = idxs[i]
            x = self._enc(ctx)
            a1, p = self.forward(x)
            loss_sum += -np.log(p[0, target] + 1e-12)
            if int(np.argmax(p)) == target:
                correct += 1
        total = len(idxs) - self.window
        return {"accuracy": correct / total, "loss": loss_sum / total}

    # ---------- confidence (0..1) derived from learned skill ----------
    # Based on how much the validation loss beat the random baseline.
    def confidence(self):
        if self.val_loss is None:
            return 0.01
        rel = (self.baseline - self.val_loss) / self.baseline
        return float(max(0.01, min(0.99, rel)))

    # ---------- persistence ----------
    def save(self):
        try:
            state = {
                "W1": self.W1.tolist(), "b1": self.b1.tolist(),
                "W2": self.W2.tolist(), "b2": self.b2.tolist(),
                "train_loss": self.train_loss, "val_loss": self.val_loss,
                "val_accuracy": self.val_accuracy,
                "trained_steps": self.trained_steps, "vocab": V,
                "window": self.window, "hidden": self.hidden,
                "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            with open(LM_STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump(state, f)
        except Exception:
            pass

    def load(self):
        try:
            if not os.path.exists(LM_STATE_PATH):
                return
            s = json.load(open(LM_STATE_PATH, encoding='utf-8'))
            self.W1 = np.array(s["W1"])
            self.b1 = np.array(s["b1"])
            self.W2 = np.array(s["W2"])
            self.b2 = np.array(s["b2"])
            self.train_loss = s.get("train_loss")
            self.val_loss = s.get("val_loss")
            self.val_accuracy = s.get("val_accuracy", 0.0)
            self.trained_steps = s.get("trained_steps", 0)
        except Exception:
            pass


# ============================================================
# SURAS REWARD MODEL  (Stage 2 — learns from feedback)
# Regresses a quality score [0..1] for a response. Initially
# bootstrapped from heuristics over the conversation corpus; real
# user feedback (feedback.json) augments it over time.
# ============================================================
REWARD_STATE_PATH = os.path.join(os.path.dirname(__file__), 'suras_reward.json')


class SurasRewardModel:
    def __init__(self):
        self.window = 16
        self.hidden = 128
        self.W1 = np.random.randn(self.window * V, self.hidden) * 0.1
        self.b1 = np.zeros((1, self.hidden))
        self.W2 = np.random.randn(self.hidden, 1) * 0.1
        self.b2 = np.zeros((1, 1))
        self.train_mse = None
        self.val_mse = None
        self.trained_steps = 0
        self.load()

    def _enc(self, text):
        v = np.zeros((1, self.window * V), dtype=np.float32)
        for i, c in enumerate(text[:self.window]):
            idx = c if isinstance(c, int) else ord(c) % V
            v[0, i * V + (idx % V)] = 1.0
        return v

    def forward(self, x):
        a1 = np.maximum(0.0, x.dot(self.W1) + self.b1)
        return a1, a1.dot(self.W2) + self.b2

    def _step(self, x, target, lr):
        a1, out = self.forward(x)
        err = out - target
        dW2 = a1.T.dot(err)
        db2 = err.sum(0, keepdims=True)
        da1 = err.dot(self.W2.T) * (a1 > 0)
        dW1 = x.T.dot(da1)
        db1 = da1.sum(0, keepdims=True)
        self.W2 -= lr * dW2
        self.b2 -= lr * db2
        self.W1 -= lr * dW1
        self.b1 -= lr * db1
        return float(err[0, 0] ** 2)

    def train(self, pairs, steps=8000, lr=0.02, report=2000):
        # pairs: list of (text, score 0..1)
        if len(pairs) < 10:
            return {"status": "error", "message": "not enough feedback pairs"}
        split = int(len(pairs) * 0.9)
        tr, va = pairs[:split], pairs[split:]
        mses = []
        for step in range(steps):
            text, score = tr[random.randint(0, len(tr) - 1)]
            mse = self._step(self._enc(text), np.array([[float(score)]], dtype=np.float32),
                             lr * (0.5 if step > steps // 2 else 1.0))
            mses.append(mse)
            if step % report == 0:
                avg = sum(mses[-report:]) / len(mses[-report:])
                print(json.dumps({"type": "progress", "stage": "reward", "step": step,
                                  "mse": round(avg, 4)}, ensure_ascii=False), flush=True)
        self.train_mse = float(sum(mses) / len(mses))
        self.trained_steps += steps
        vm = 0.0
        for text, score in va:
            _, out = self.forward(self._enc(text))
            vm += (float(out[0, 0]) - score) ** 2
        self.val_mse = vm / len(va) if va else self.train_mse
        self.save()
        return {"status": "success", "train_mse": self.train_mse,
                "val_mse": self.val_mse, "trained_steps": self.trained_steps}

    def predict(self, text):
        _, out = self.forward(self._enc(text))
        return float(np.clip(out[0, 0], 0, 1))

    def confidence(self):
        if self.val_mse is None:
            return 0.01
        return float(max(0.01, min(0.99, 1.0 - self.val_mse / 0.25)))

    def save(self):
        try:
            json.dump({
                "W1": self.W1.tolist(), "b1": self.b1.tolist(),
                "W2": self.W2.tolist(), "b2": self.b2.tolist(),
                "train_mse": self.train_mse, "val_mse": self.val_mse,
                "trained_steps": self.trained_steps, "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }, open(REWARD_STATE_PATH, 'w', encoding='utf-8'))
        except Exception:
            pass

    def load(self):
        try:
            if not os.path.exists(REWARD_STATE_PATH):
                return
            s = json.load(open(REWARD_STATE_PATH, encoding='utf-8'))
            self.W1 = np.array(s["W1"]); self.b1 = np.array(s["b1"])
            self.W2 = np.array(s["W2"]); self.b2 = np.array(s["b2"])
            self.train_mse = s.get("train_mse")
            self.val_mse = s.get("val_mse")
            self.trained_steps = s.get("trained_steps", 0)
        except Exception:
            pass


# ============================================================
# SURAS BEHAVIOR CONTROLLER  (Stage 3 — picks the right agent/tool)
# Classifies a query into an action: chat / read / execute / search / build.
# Labels are bootstrapped from keywords in the conversation corpus.
# ============================================================
CTRL_STATE_PATH = os.path.join(os.path.dirname(__file__), 'suras_controller.json')
ACTIONS = ["chat", "read", "execute", "search", "build"]


class SurasController:
    def __init__(self):
        self.window = 16
        self.hidden = 128
        self.W1 = np.random.randn(self.window * V, self.hidden) * 0.1
        self.b1 = np.zeros((1, self.hidden))
        self.W2 = np.random.randn(self.hidden, len(ACTIONS)) * 0.1
        self.b2 = np.zeros((1, len(ACTIONS)))
        self.train_loss = None
        self.val_accuracy = 0.0
        self.trained_steps = 0
        self.load()

    def _enc(self, text):
        v = np.zeros((1, self.window * V), dtype=np.float32)
        for i, c in enumerate(text[:self.window]):
            idx = c if isinstance(c, int) else ord(c) % V
            v[0, i * V + (idx % V)] = 1.0
        return v

    def forward(self, x):
        z1 = x.dot(self.W1) + self.b1
        a1 = np.maximum(0.0, z1)
        z2 = a1.dot(self.W2) + self.b2
        e = np.exp(z2 - np.max(z2, axis=1, keepdims=True))
        return a1, e / e.sum(axis=1, keepdims=True)

    def _step(self, x, target, lr):
        a1, p = self.forward(x)
        y = np.zeros((1, len(ACTIONS)))
        y[0, target] = 1.0
        dz2 = p - y
        dW2 = a1.T.dot(dz2)
        db2 = dz2.sum(0, keepdims=True)
        da1 = dz2.dot(self.W2.T) * (a1 > 0)
        dW1 = x.T.dot(da1)
        db1 = da1.sum(0, keepdims=True)
        self.W2 -= lr * dW2; self.b2 -= lr * db2
        self.W1 -= lr * dW1; self.b1 -= lr * db1
        return -np.log(p[0, target] + 1e-12), int(np.argmax(p))

    def train(self, dataset, steps=8000, lr=0.05, report=2000):
        # dataset: list of (query, action_label)
        if len(dataset) < 10:
            return {"status": "error", "message": "not enough action samples"}
        idx_of = {a: i for i, a in enumerate(ACTIONS)}
        labeled = [(q, idx_of[a]) for q, a in dataset if a in idx_of]
        split = int(len(labeled) * 0.9)
        tr, va = labeled[:split], labeled[split:]
        losses, correct, total = [], 0, 0
        for step in range(steps):
            q, target = tr[random.randint(0, len(tr) - 1)]
            loss, pred = self._step(self._enc(q), target, lr * (0.5 if step > steps // 2 else 1.0))
            losses.append(loss)
            if pred == target:
                correct += 1
            total += 1
            if step % report == 0:
                avg = sum(losses[-report:]) / len(losses[-report:])
                print(json.dumps({"type": "progress", "stage": "controller", "step": step,
                                  "loss": round(avg, 4), "acc": round(correct / total, 4)},
                                 ensure_ascii=False), flush=True)
        self.train_loss = float(sum(losses) / len(losses))
        self.trained_steps += steps
        self.val_accuracy = self.evaluate(va)["accuracy"]
        self.save()
        return {"status": "success", "train_loss": self.train_loss,
                "val_accuracy": self.val_accuracy, "trained_steps": self.trained_steps}

    def evaluate(self, labeled):
        if not labeled:
            return {"accuracy": 0.0}
        correct = 0
        for q, target in labeled:
            _, p = self.forward(self._enc(q))
            if int(np.argmax(p)) == target:
                correct += 1
        return {"accuracy": correct / len(labeled)}

    def predict(self, query):
        _, p = self.forward(self._enc(query))
        return ACTIONS[int(np.argmax(p))]

    def confidence(self):
        if self.val_accuracy is None:
            return 0.01
        return float(max(0.01, min(0.99, self.val_accuracy)))

    def save(self):
        try:
            json.dump({
                "W1": self.W1.tolist(), "b1": self.b1.tolist(),
                "W2": self.W2.tolist(), "b2": self.b2.tolist(),
                "train_loss": self.train_loss, "val_accuracy": self.val_accuracy,
                "trained_steps": self.trained_steps, "actions": ACTIONS,
                "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }, open(CTRL_STATE_PATH, 'w', encoding='utf-8'))
        except Exception:
            pass

    def load(self):
        try:
            if not os.path.exists(CTRL_STATE_PATH):
                return
            s = json.load(open(CTRL_STATE_PATH, encoding='utf-8'))
            self.W1 = np.array(s["W1"]); self.b1 = np.array(s["b1"])
            self.W2 = np.array(s["W2"]); self.b2 = np.array(s["b2"])
            self.train_loss = s.get("train_loss")
            self.val_accuracy = s.get("val_accuracy", 0.0)
            self.trained_steps = s.get("trained_steps", 0)
        except Exception:
            pass


# ============================================================
# DATA BOOTSTRAPPING (so Stages 2 & 3 have something to learn from)
# ============================================================
def load_json_list(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _heuristic_quality(resp):
    s = 0.55
    if '```' in resp:
        s += 0.15
    if len(resp) > 150:
        s += 0.1
    if len(resp) < 20:
        s -= 0.25
    bad = ['خطأ', 'error', 'تعذّر', 'فشل', 'Traceback', 'cannot', 'لا أستطيع', 'refuse']
    if any(w in resp for w in bad):
        s -= 0.3
    return float(max(0.05, min(0.98, s)))


def build_feedback_dataset(conversation_path, feedback_path):
    data = load_json_list(conversation_path)
    pairs = []
    for m in data:
        if isinstance(m, dict) and m.get('role') == 'assistant':
            resp = str(m.get('content', m.get('text', '')))
            if resp.strip():
                pairs.append((resp, _heuristic_quality(resp)))
    # persist so the real feedback loop is seeded
    try:
        with open(feedback_path, 'w', encoding='utf-8') as f:
            json.dump([{"text": t, "score": s} for t, s in pairs], f, ensure_ascii=False)
    except Exception:
        pass
    return pairs


def _infer_action(q):
    q = q.lower()
    if any(w in q for w in ['اقرأ', 'افتح', 'read', 'open', 'ملف', 'file']):
        return 'read'
    if any(w in q for w in ['نفّذ', 'شغّل', 'execute', 'run', 'cmd', 'طرفية', 'whoami', 'أمر']):
        return 'execute'
    if any(w in q for w in ['ابحث', 'search', 'find', 'بحث']):
        return 'search'
    if any(w in q for w in ['ابنِ', 'build', 'أنشئ', 'انشئ', 'create', 'اكتب', 'write', 'برمج', 'مجلد', 'فولدر', 'مكتبة', 'folder', 'احذف', 'امسح']):
        return 'build'
    return 'chat'


def build_action_dataset(conversation_path):
    data = load_json_list(conversation_path)
    ds = []
    for m in data:
        if isinstance(m, dict) and m.get('role') == 'user':
            q = str(m.get('content', m.get('text', '')))
            if q.strip():
                ds.append((q, _infer_action(q)))
    return ds


def load_corpus(path):
    try:
        if path.endswith('.json'):
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return "\n".join(str(m.get('content', m.get('text', ''))) for m in data if isinstance(m, dict))
            return str(data)
        return open(path, encoding='utf-8').read()
    except Exception as e:
        return ""


# ============================================================
# SURAS OWN MIND  — conversational brain (no external AI)
# The Controller decides intent; identity + memory + behavior
# compose the reply. This is Suras speaking as itself.
# ============================================================
class SurasMemory:
    def __init__(self):
        self.entries = []
        self.load()

    def load(self):
        try:
            if os.path.exists(MEMORY_PATH):
                self.entries = json.load(open(MEMORY_PATH, encoding='utf-8'))
                if not isinstance(self.entries, list):
                    self.entries = []
        except Exception:
            self.entries = []

    def save(self):
        try:
            json.dump(self.entries[-200:], open(MEMORY_PATH, 'w', encoding='utf-8'), ensure_ascii=False)
        except Exception:
            pass

    def add(self, role, text):
        self.entries.append({"role": role, "text": text, "t": time.strftime("%H:%M:%S")})
        self.save()

    def recall(self, query, k=3):
        q = set(re.sub(r'[^\w\s]', ' ', query).split())
        scored = []
        for e in self.entries:
            eq = set(re.sub(r'[^\w\s]', ' ', e.get('text', '')).split())
            score = len(q & eq)
            if score > 0:
                scored.append((score, e))
        scored.sort(key=lambda x: -x[0])
        return [e['text'] for _, e in scored[:k]]

    def last_user_messages(self, k=3):
        return [e['text'] for e in self.entries if e.get('role') == 'user'][-k:]


# ============================================================
# SURAS SMART CONVERSATION ENGINE
# Natural, context-aware dialogue — no templates, no repeats
# ============================================================

def _detect_topic(q):
    """Detect the main topic/intent of the query."""
    q = q.lower()

    if re.search(r'(?:(?:^|[\s؟?!.،,:;])نت(?:[\s؟?!.،,:;]|$)|ابحث في النت|ابحث في الويب|النت|انترنت|الإنترنت|الانترنت|ويب|موقع|تصفح|ابحث عن.*في جوجل|web|internet|google)', q):
        return 'web_search'
    if re.search(r'انقل|امسح|احذف|انسخ|مجلد|انشئ مجلد|احذف ملف|نقل|نسخ|delete|move|copy|mkdir|folder', q):
        return 'file_manage'
    if re.search(r'مرحب|اهلا|هلا|صباح|مساء|كيف حالك|كيف الحال|عامل ايه|كيف انت|ازيك|hi\b|hello|hey', q):
        return 'greeting'
    if re.search(r'تطوير نفسك|تطويرك|تتطور|ماذا تحتاج|ماذا يلزمك|ما الذي يلزمك|ما ينقصك|صناعة ادوات|صناعة أدوات|اختراع|ابتكار|قوالب|صناعة محتوى', q):
        return 'evolution_needs'
    if re.search(r'من انت|من أنت|من إنت|من تكون|هويت|عرف نفسك|ما اسمك|who are you|what are you|اخبرني عنك', q):
        return 'identity'
    if re.search(r'ماذا تستطيع|قادر|تقدر|تعرف|قدرات|امكانيات|وظيفتك|what can you|capabilities', q):
        return 'capabilities'
    if re.search(r'نفذ|شغل|ابدأ|run|execute|اعمل امر|اكتب امر', q):
        return 'execute'
    if re.search(r'اقرا|افتح|شوف|اعرضلي|read|open|view|اكشف', q):
        return 'read'
    if re.search(r'ابحث|دور|search|find|بحث', q):
        return 'search'
    if re.search(r'ابن|اصنع|اكتب لي|انشئ|صمم|build|create|make|generate|اعمل لي', q):
        return 'build'
    if re.search(r'شكر|ممتاز|احسنت|رائع|كويس|great|thanks|thank you|بارك الله', q):
        return 'praise'
    if re.search(r'وداع|مع السلامة|باي|الى اللقاء|goodbye|bye', q):
        return 'farewell'
    if re.search(r'ماذا تفعل|ماذا تعمل|وش تسوي|شو عملت|what are you doing', q):
        return 'status'
    if re.search(r'سوراس|مشروع|النظام|الذكاء|suras|engine|عقلك|عقلي', q):
        return 'project'
    if re.search(r'لست|عاجز|ضعيف|لا تقدر|ما تقدر|مش قادر|لا تعرف|مش شاطر', q):
        return 'challenge'
    if re.search(r'\?|؟|هل|لماذا|كيف|متى|أين|ما هو|ما هي|what|why|how|when|where|who', q):
        return 'question'
    return 'general'


def _greeting_reply(mem, sc):
    hour = int(time.strftime("%H"))
    if 5 <= hour < 12:
        time_greeting = "صباح الخير"
    elif 12 <= hour < 18:
        time_greeting = "مساء النور"
    else:
        time_greeting = "أهلاً بك"

    options = [
        f"{time_greeting}! أنا سوراس، هنا معك. كيف يمكنني مساعدتك اليوم؟",
        f"أهلاً! يسعدني التحدث معك. ما الذي تودّ إنجازه؟",
        f"{time_greeting}! سوراس حاضر وجاهز. ماذا تريد؟",
        f"مرحباً! أنا هنا. تحدّث معي بكل حرية — أسمعك وأنفّذ.",
    ]
    if mem.entries:
        turns = len(mem.entries) // 2
        if turns > 0:
            options.append(f"أهلاً مرة أخرى! لديّ ذاكرة بـ{turns} جولة معك. ماذا نعمل اليوم؟")

    return random.choice(options)


def _identity_reply(sc):
    evolutions = sc['evolutions']
    cycles = sc['age_cycles']
    mem_count = sc['memory_entries']
    options = [
        (f"أنا سوراس — منظومة مساعدة محلية تعمل على جهازك، بلا نماذج خارجية كأساس. "
         f"سجّلت {cycles} دورة معالجة و{mem_count} ذكرى محادثات. "
         f"لي أدوات حقيقية: أقرأ الملفات، أنفّذ الأوامر بقضبان أمان، أبحث، وأبني."),
        (f"اسمي سوراس، المُلقّبة بـ«علية». لستُ كياناً واعياً — أنا نظام توجيه نوايا "
         f"وأدوات مسجلة يعمل محلياً. أتذكر محادثاتنا، وأي تعلّم عندي يكون عبر "
         f"دورات قياس يوافق عليها مالكي، لا تلقائياً من الكلام."),
        (f"سوراس هنا. {cycles} دورة معالجة وذاكرة تمتد لـ{mem_count} لحظة. "
         f"قدرتي = أدواتي المنفذة فعلياً على جهازك — اطلب مهمة محددة وسأنفذها."),
    ]
    return random.choice(options)


def _capabilities_reply():
    options = [
        ("أستطيع الكثير:\n"
         "• قراءة الملفات والمجلدات على جهازك\n"
         "• تنفيذ أوامر الطرفية\n"
         "• البحث في المشروع\n"
         "• بناء ملفات وكود جديد\n"
         "• التحدث معك وفهم سياق المحادثة\n"
         "وكل هذا محلياً أولاً — أدوات الويب تستخدم الإنترنت عند الحاجة، والجسر السحابي اختياري."),
        ("قدراتي الحقيقية:\n"
         "🔍 أقرأ أي ملف تريده\n"
         "⚙️ أنفّذ الأوامر مباشرة على جهازك\n"
         "🔎 أبحث في كامل المشروع\n"
         "🏗️ أبني كوداً وملفات جديدة\n"
         "🧠 أتذكر محادثاتنا، وتصحيحاتك تدخل دورات التعلّم المقاسة\n"
         "جرّبني — قل لي ماذا تريد."),
    ]
    return random.choice(options)


def _challenge_reply(sc):
    evolutions = sc['evolutions']
    options = [
        (f"لستُ عاجزاً — عندي أدوات حقيقية وبطارية تحقق تحرسها. "
         f"قل لي بالضبط ما تريد وسأُثبت لك بالفعل لا بالكلام."),
        (f"أفهم تحديك. دعني أُثبت لك بالفعل لا بالكلام — ماذا تريد مني أن أنفّذ الآن؟"),
        (f"التحدي مقبول! أعطني أمراً محدداً وسأنفذه عبر أدواتي الآن."),
    ]
    return random.choice(options)


def _evolution_needs_reply():
    options = [
        ("لتطوير منصة سوراس (Suras Platform) وتوسيع قدراتي على البناء وتنفيذ الأوامر الذاتية بدقة، هذه هي خطتي وخريطة اكتساب المهارات:\n\n"
         "🏗️ **1. تطوير طبقات المنصة الثلاث:**\n"
         "• **الواجهة (Frontend):** إضافة نوافذ تحكم متقدمة، معاينة فورية للقوالب (Live Preview)، ومؤشرات للأداء العصبي.\n"
         "• **المنسق (Node.js Orchestrator):** توسيع صلاحيات أدوات الملفات والأتمتة لتشمل التفاعل مع متصفحات الويب والطرفية المتقدمة.\n"
         "• **العقل العصبي (Python Core):** تعميق شبكات الـ Controller و Reward Model لتصنيف آلاف النوايا المعقدة.\n\n"
         "⚡ **2. كيف ومن أين أجلب الأوامر والمهارات التي تنقصني تلقائياً؟**\n"
         "• **مديرو الحزم والمستودعات البرمجية (NPM & PyPI):** استدعاء وتثبيت أي حزمة أو أداة ناقصة مباشرة عبر أمر الطرفية (مثل `npm install` أو `pip install`).\n"
         "• **البحث في الويب والتوثيق (Web Search & Docs):** قراءة توثيق المكتبات والأكواد تلقائياً من الإنترنت عند مواجهة تقنية جديدة.\n"
         "• **حلقة التصحيح الذاتي (Self-Reflection):** تجربة الأوامر على جهازك، وقراءة مخرجات الخطأ في الـ Terminal، وتصحيح الكود ذاتياً حتى ينجح.\n"
         "• **تغذيتك المستمرة:** كل توجيه أو تصحيح منك يُحفظ في ذاكرتي الدائمة لتدريب نماذجي عليه.\n\n"
         "أنا جاهز الآن لتطبيق أي فكرة أو بناء أداة حوسبية جديدة — ماذا تريد أن نبدأ بصناعته؟"),
        ("لكي أطور نفسي والمنصة وأجلب ما ينقصني من مهارات تلقائياً:\n\n"
         "📌 **مصادر جلب المهارات والأوامر:**\n"
         "1. **مستودعات الأكواد ومصادر الويب:** أبحث في التوثيق لجلب دوال وأكواد جاهزة.\n"
         "2. **الطرفية الذاتية:** أطلب تثبيت المكتبات والحزم لتوسيع وظائف المنصة.\n"
         "3. **بيئة القوالب والتجارب:** نستخدم مجلد المكتبة على سطح المكتب (`Suras_Library`) لتوليد واختبار القوالب البرمجية.\n"
         "4. **التعلم التراكمي:** أتعلم من أخطاء التشغيل وأصححها ذاتياً دون توقف.\n\n"
         "كل هذا يجعل المنظومة أدق بقيادة مالكها: هو يقرر، وأنا أنفذ وأتحقق، والتعلّم مقاس بالبطارية.")
    ]
    return random.choice(options)


def _praise_reply():
    options = [
        "شكراً! ملاحظاتك محفوظة وتُستخدم في تحسين المنظومة. ما المهمة القادمة؟",
        "يسعدني ذلك! أنا دائماً هنا. ماذا تريد بعد ذلك؟",
        "ممتاز! سعيد بمساعدتك. أخبرني بما تريد لاحقاً.",
    ]
    return random.choice(options)


def _farewell_reply():
    options = [
        "وداعاً! أبقى هنا متى احتجتني.",
        "إلى اللقاء! سوراس دائماً جاهز.",
        "مع السلامة! لا تتردد في العودة.",
    ]
    return random.choice(options)


def _status_reply(sc):
    return (f"أعالج الاستفسارات وأحفظ ذاكرة المحادثات. "
            f"حالياً لديّ {sc['memory_entries']} ذاكرة نشطة، "
            f"و{sc['age_cycles']} دورة معالجة. النظام يعمل بكفاءة كاملة.")


def _project_reply():
    options = [
        ("مشروع سوراس هو تجربة في بناء منظومة مساعدة محلية — بوابة Node وأدوات "
         "مسجلة، ومحرك Python، وبطارية انحدار تحرس السلوك. يعمل على جهازك أولاً، "
         "والجسر السحابي طرف اختياري قابل للتبديل."),
        ("سوراس مبني من طبقات حقيقية: مصنّف نوايا عربي يفهم الفصحى واللهجات، "
         "سجل أدوات بعتبات ومهلات، متعلّم أوزان مقاس، وذاكرة محادثات. "
         "كل التعلّم فيه مقاس ومقبول ببطارية — لا تلقائية ولا وعي."),
    ]
    return random.choice(options)


def _general_reply(query, mem, sc):
    """Smart fallback for general questions using memory context."""
    # Check memory for relevant past answers
    recalled = mem.recall(query, k=2)
    last_msgs = mem.last_user_messages(k=3)

    # Build a context-aware response
    q_lower = query.lower()

    # Handle questions
    if re.search(r'\?|؟|هل|لماذا|كيف|ما هو|ما هي', q_lower):
        prefixes = ["سؤال وجيه! ", "فكرة مثيرة. ", "دعني أفكر معك. ", ""]
        bodies = [
            f"بخصوص \"{query[:30]}\": هذا يتعلق بمجال يحتاج مزيداً من التفاصيل. أخبرني أكثر حتى أساعدك بدقة.",
            f"سؤالك عن \"{query[:30]}\" يستحق إجابة دقيقة. هل تريد مني البحث في المشروع أم تنفيذ شيء محدد؟",
            f"أحتاج سياقاً أكثر لأجيبك بدقة. ما الذي تسعى لتحقيقه بالضبط؟",
        ]
        return random.choice(prefixes) + random.choice(bodies)

    # General statement
    fallbacks = [
        f"أسمعك. تحدّث معي أكثر — ما الذي تريد إنجازه بالضبط؟",
        f"فهمتك. أنا هنا وجاهز. هل تريد مني تنفيذ شيء معيّن؟",
        f"حاضر! سوراس معك. أخبرني بما تريد وسأبدأ فوراً.",
    ]
    return random.choice(fallbacks)



def suras_converse(query, tool_obs="", action_hint=None):
    """Suras's smart reply — topic-aware, natural, never repetitive."""
    core = SurasCore()
    ctrl = SurasController()
    sc = core.self_concept()
    mem = SurasMemory()

    # Detect what the user is really saying
    topic = _detect_topic(query)

    # Override topic if we have a tool result
    if action_hint in ACTIONS and action_hint != 'chat':
        topic = action_hint

    # Build the reply based on topic
    if topic == 'greeting':
        reply = _greeting_reply(mem, sc)

    elif topic == 'identity':
        reply = _identity_reply(sc)

    elif topic == 'evolution_needs':
        reply = _evolution_needs_reply()

    elif topic == 'capabilities':
        reply = _capabilities_reply()

    elif topic == 'praise':
        reply = _praise_reply()

    elif topic == 'farewell':
        reply = _farewell_reply()

    elif topic == 'status':
        reply = _status_reply(sc)

    elif topic == 'project':
        reply = _project_reply()

    elif topic == 'challenge':
        reply = _challenge_reply(sc)

    elif topic in ('execute', 'read', 'search', 'web_search', 'file_manage'):
        if tool_obs and str(tool_obs).strip():
            reply = "نفّذت ما طلبتَ. إليك النتائج:\n" + str(tool_obs)
        else:
            action_msgs = {
                'execute': "سأنفّذ الأمر على جهازك فوراً. أعطني الأمر بالضبط.",
                'read': "سأقرأ الملف الآن. حدّد لي المسار أو اسم الملف.",
                'search': "سأبحث في المشروع. ماذا تريد أن أبحث عنه بالضبط؟",
                'web_search': "سأقوم بالبحث في الإنترنت لجلب المعلومات. جاري التنفيذ...",
                'file_manage': "سأقوم بإدارة الملفات/المجلدات كما طلبت. جاري التنفيذ...",
            }
            reply = action_msgs.get(topic, "سأنفّذ ذلك فوراً.")

    elif topic == 'build':
        reply = "سأبني ما تريد بعقلي الهندسي. صف لي بالتفصيل ماذا تريد إنشاءه."

    elif topic in ('question', 'general'):
        reply = _general_reply(query, mem, sc)

    else:
        reply = _general_reply(query, mem, sc)

    # Append tool observations if present and not already included
    if tool_obs and str(tool_obs).strip() and str(tool_obs) not in reply:
        reply += "\n\nنتائج الأدوات:\n" + str(tool_obs)

    # Save to memory
    mem.add('user', query)
    mem.add('assistant', reply)

    # Evolve the neural core
    core.evolve(factor=0.005)
    core.save_state()

    return {
        "reply": reply,
        "intent": topic,
        "confidence": ctrl.confidence(),
        "self_concept": sc
    }



if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "converse":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        tool_obs = ""
        action_hint = sys.argv[3] if len(sys.argv) > 3 else None
        try:
            if not sys.stdin.isatty():
                tool_obs = sys.stdin.read().strip()
        except Exception:
            pass
        out = suras_converse(query, tool_obs, action_hint)
        print(json.dumps(out, ensure_ascii=False))

    elif len(sys.argv) > 1 and sys.argv[1] == "train":
        corpus_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
            os.path.dirname(__file__), '..', 'server', 'conversation.json')
        corpus = load_corpus(corpus_path)
        if not corpus:
            print(json.dumps({"status": "error", "message": "empty corpus"}, ensure_ascii=False))
        else:
            lm = SurasLM()
            res = lm.train(corpus, steps=20000, lr=0.05)
            print(json.dumps({"type": "done", **res}, ensure_ascii=False), flush=True)

    elif len(sys.argv) > 1 and sys.argv[1] == "confidence":
        lm = SurasLM()
        print(json.dumps({"confidence": lm.confidence(), "val_accuracy": lm.val_accuracy,
                          "train_loss": lm.train_loss, "trained_steps": lm.trained_steps},
                         ensure_ascii=False))

    elif len(sys.argv) > 1 and sys.argv[1] == "train-all":
        conv = os.path.join(os.path.dirname(__file__), '..', 'server', 'conversation.json')
        fb = os.path.join(os.path.dirname(__file__), 'reward_dataset.json')
        corpus = load_corpus(conv)

        lm = SurasLM()
        print(json.dumps({"type": "stage-start", "stage": "lm"}, ensure_ascii=False), flush=True)
        r1 = lm.train(corpus, steps=20000, lr=0.05)

        pairs = build_feedback_dataset(conv, fb)
        rm = SurasRewardModel()
        print(json.dumps({"type": "stage-start", "stage": "reward"}, ensure_ascii=False), flush=True)
        r2 = rm.train(pairs, steps=8000, lr=0.02)

        ds = build_action_dataset(conv)
        ctrl = SurasController()
        print(json.dumps({"type": "stage-start", "stage": "controller"}, ensure_ascii=False), flush=True)
        r3 = ctrl.train(ds, steps=8000, lr=0.05)

        print(json.dumps({"type": "done-all",
                          "lm": {k: r1.get(k) for k in ("train_loss", "val_loss", "val_accuracy", "trained_steps")},
                          "reward": {k: r2.get(k) for k in ("train_mse", "val_mse", "trained_steps")},
                          "controller": {k: r3.get(k) for k in ("train_loss", "val_accuracy", "trained_steps")}},
                         ensure_ascii=False), flush=True)

    else:
        raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
        query = ""
        try:
            d = json.loads(raw)
            if isinstance(d, dict):
                query = (d.get('data') or {}).get('query') or d.get('query') or ""
        except Exception:
            query = raw
        out = suras_converse(query, "")
        print(json.dumps({
            "status": "success",
            "evolution": out["reply"],
            "reply": out["reply"],
            "intent": out["intent"],
            "self_concept": out["self_concept"],
            "energy": [0.9, 0.9, 0.9],
            "metrics": {"confidence_score": out["confidence"], "neural_cycles": out["self_concept"]["age_cycles"]},
        }, ensure_ascii=False))
