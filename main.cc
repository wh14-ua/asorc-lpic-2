// =====================================================================
//  test-ASORC — Banco de preguntas LPIC-2
//
//  Aplicación de terminal que estudia el banco de preguntas extraído de
//  los dos libros de preparación LPIC-2 (questions.json) y guarda el
//  progreso de forma persistente (progress.json).
//
//  Compilar:  g++ -std=c++17 -O2 -Wall -Wextra -o asorc main.cc
//  Ejecutar:  ./asorc [--questions ruta.json] [--progress ruta.json] [--no-color]
// =====================================================================

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <numeric>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#if defined(__unix__) || defined(__APPLE__)
#include <termios.h>
#include <unistd.h>
#define ASORC_POSIX 1
#else
#define ASORC_POSIX 0
#endif

// =====================================================================
//  1. JSON mínimo (parser + serializador), sin dependencias externas
// =====================================================================
namespace json {

class Value;
using Object = std::vector<std::pair<std::string, Value>>;
using Array  = std::vector<Value>;

enum class Type { Null, Bool, Number, String, Arr, Obj };

class Value {
public:
    Type type = Type::Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::shared_ptr<Array> arr;
    std::shared_ptr<Object> obj;

    Value() = default;
    static Value makeObject() { Value v; v.type = Type::Obj; v.obj = std::make_shared<Object>(); return v; }
    static Value makeArray()  { Value v; v.type = Type::Arr; v.arr = std::make_shared<Array>();  return v; }
    static Value make(const std::string& s) { Value v; v.type = Type::String; v.str = s; return v; }
    static Value make(double d)             { Value v; v.type = Type::Number; v.num = d; return v; }
    static Value make(bool x)               { Value v; v.type = Type::Bool;   v.b = x;   return v; }

    bool isNull()   const { return type == Type::Null; }
    bool isObject() const { return type == Type::Obj; }
    bool isArray()  const { return type == Type::Arr; }

    // Acceso a miembros de objeto (devuelve nulo si no existe)
    const Value* find(const std::string& key) const {
        if (type != Type::Obj || !obj) return nullptr;
        for (const auto& kv : *obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }
    void set(const std::string& key, const Value& v) {
        if (type != Type::Obj) { type = Type::Obj; obj = std::make_shared<Object>(); }
        for (auto& kv : *obj)
            if (kv.first == key) { kv.second = v; return; }
        obj->emplace_back(key, v);
    }
    void push(const Value& v) {
        if (type != Type::Arr) { type = Type::Arr; arr = std::make_shared<Array>(); }
        arr->push_back(v);
    }

    std::string asString(const std::string& def = "") const {
        if (type == Type::String) return str;
        return def;
    }
    long asInt(long def = 0) const {
        if (type == Type::Number) return static_cast<long>(num);
        if (type == Type::String) { try { return std::stol(str); } catch (...) { return def; } }
        return def;
    }
    double asDouble(double def = 0) const { return type == Type::Number ? num : def; }
    bool asBool(bool def = false) const { return type == Type::Bool ? b : def; }

    const Array&  items()   const { static const Array  e; return arr ? *arr : e; }
    const Object& members() const { static const Object e; return obj ? *obj : e; }
};

// ------------------------------- parser -------------------------------
class Parser {
public:
    explicit Parser(const std::string& s) : s_(s) {}

    Value parse() {
        skipWs();
        Value v = parseValue();
        skipWs();
        return v;
    }

private:
    const std::string& s_;
    size_t i_ = 0;

    [[noreturn]] void fail(const std::string& msg) const {
        size_t line = 1, col = 1;
        for (size_t k = 0; k < i_ && k < s_.size(); ++k) {
            if (s_[k] == '\n') { ++line; col = 1; } else ++col;
        }
        throw std::runtime_error("JSON: " + msg + " (línea " + std::to_string(line) +
                                 ", columna " + std::to_string(col) + ")");
    }
    bool eof() const { return i_ >= s_.size(); }
    char peek() const { if (eof()) return '\0'; return s_[i_]; }

    void skipWs() {
        while (!eof()) {
            char c = s_[i_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ++i_;
            else break;
        }
    }

    Value parseValue() {
        if (eof()) fail("fin de entrada inesperado");
        char c = peek();
        switch (c) {
            case '{': return parseObject();
            case '[': return parseArray();
            case '"': { Value v; v.type = Type::String; v.str = parseString(); return v; }
            case 't': expect("true");  return Value::make(true);
            case 'f': expect("false"); return Value::make(false);
            case 'n': expect("null");  return Value();
            default:  return parseNumber();
        }
    }

    void expect(const char* lit) {
        size_t n = std::char_traits<char>::length(lit);
        if (s_.compare(i_, n, lit) != 0) fail(std::string("se esperaba '") + lit + "'");
        i_ += n;
    }

    Value parseObject() {
        Value v = Value::makeObject();
        ++i_;                      // '{'
        skipWs();
        if (peek() == '}') { ++i_; return v; }
        while (true) {
            skipWs();
            if (peek() != '"') fail("se esperaba una clave entre comillas");
            std::string key = parseString();
            skipWs();
            if (peek() != ':') fail("se esperaba ':'");
            ++i_;
            skipWs();
            v.obj->emplace_back(key, parseValue());
            skipWs();
            if (peek() == ',') { ++i_; continue; }
            if (peek() == '}') { ++i_; break; }
            fail("se esperaba ',' o '}'");
        }
        return v;
    }

    Value parseArray() {
        Value v = Value::makeArray();
        ++i_;                      // '['
        skipWs();
        if (peek() == ']') { ++i_; return v; }
        while (true) {
            skipWs();
            v.arr->push_back(parseValue());
            skipWs();
            if (peek() == ',') { ++i_; continue; }
            if (peek() == ']') { ++i_; break; }
            fail("se esperaba ',' o ']'");
        }
        return v;
    }

    static void appendUtf8(std::string& out, uint32_t cp) {
        if (cp <= 0x7F) out += static_cast<char>(cp);
        else if (cp <= 0x7FF) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp <= 0xFFFF) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    uint32_t parseHex4() {
        if (i_ + 4 > s_.size()) fail("escape \\u incompleto");
        uint32_t v = 0;
        for (int k = 0; k < 4; ++k) {
            char c = s_[i_ + k];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
            else fail("dígito hexadecimal inválido en \\u");
        }
        i_ += 4;
        return v;
    }

    std::string parseString() {
        ++i_;                      // '"'
        std::string out;
        while (true) {
            if (eof()) fail("cadena sin cerrar");
            char c = s_[i_++];
            if (c == '"') break;
            if (c != '\\') { out += c; continue; }
            if (eof()) fail("escape sin completar");
            char e = s_[i_++];
            switch (e) {
                case '"':  out += '"';  break;
                case '\\': out += '\\'; break;
                case '/':  out += '/';  break;
                case 'b':  out += '\b'; break;
                case 'f':  out += '\f'; break;
                case 'n':  out += '\n'; break;
                case 'r':  out += '\r'; break;
                case 't':  out += '\t'; break;
                case 'u': {
                    uint32_t cp = parseHex4();
                    if (cp >= 0xD800 && cp <= 0xDBFF && i_ + 1 < s_.size() &&
                        s_[i_] == '\\' && s_[i_ + 1] == 'u') {
                        size_t save = i_;
                        i_ += 2;
                        uint32_t lo = parseHex4();
                        if (lo >= 0xDC00 && lo <= 0xDFFF)
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        else i_ = save;
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("escape desconocido");
            }
        }
        return out;
    }

    Value parseNumber() {
        size_t start = i_;
        if (peek() == '-' || peek() == '+') ++i_;
        while (!eof() && (std::isdigit(static_cast<unsigned char>(peek())) || peek() == '.' ||
                          peek() == 'e' || peek() == 'E' || peek() == '-' || peek() == '+'))
            ++i_;
        if (start == i_) fail("número inválido");
        try {
            return Value::make(std::stod(s_.substr(start, i_ - start)));
        } catch (...) {
            fail("número inválido");
        }
    }
};

// ---------------------------- serializador ----------------------------
inline void escapeTo(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);   // UTF-8 tal cual
                }
        }
    }
    out += '"';
}

inline void numberTo(std::string& out, double d) {
    if (d == static_cast<long long>(d) && std::abs(d) < 1e15) {
        out += std::to_string(static_cast<long long>(d));
    } else {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.6g", d);
        out += buf;
    }
}

inline void dump(std::string& out, const Value& v, int indent, int depth) {
    std::string pad(static_cast<size_t>(indent * (depth + 1)), ' ');
    std::string padEnd(static_cast<size_t>(indent * depth), ' ');
    switch (v.type) {
        case Type::Null:   out += "null"; break;
        case Type::Bool:   out += v.b ? "true" : "false"; break;
        case Type::Number: numberTo(out, v.num); break;
        case Type::String: escapeTo(out, v.str); break;
        case Type::Arr: {
            if (v.items().empty()) { out += "[]"; break; }
            out += "[\n";
            bool first = true;
            for (const auto& e : v.items()) {
                if (!first) out += ",\n";
                first = false;
                out += pad;
                dump(out, e, indent, depth + 1);
            }
            out += "\n" + padEnd + "]";
            break;
        }
        case Type::Obj: {
            if (v.members().empty()) { out += "{}"; break; }
            out += "{\n";
            bool first = true;
            for (const auto& kv : v.members()) {
                if (!first) out += ",\n";
                first = false;
                out += pad;
                escapeTo(out, kv.first);
                out += ": ";
                dump(out, kv.second, indent, depth + 1);
            }
            out += "\n" + padEnd + "}";
            break;
        }
    }
}

inline std::string serialize(const Value& v) {
    std::string out;
    dump(out, v, 1, 0);
    return out;
}

}  // namespace json

// =====================================================================
//  2. Utilidades de terminal (color, UTF-8, ajuste de línea, teclado)
// =====================================================================
namespace term {

bool g_color = true;

inline const char* RESET() { return g_color ? "\033[0m"  : ""; }
inline const char* BOLD()  { return g_color ? "\033[1m"  : ""; }
inline const char* DIM()   { return g_color ? "\033[2m"  : ""; }
inline const char* RED()   { return g_color ? "\033[31m" : ""; }
inline const char* GREEN() { return g_color ? "\033[32m" : ""; }
inline const char* YEL()   { return g_color ? "\033[33m" : ""; }
inline const char* BLUE()  { return g_color ? "\033[34m" : ""; }
inline const char* MAG()   { return g_color ? "\033[35m" : ""; }
inline const char* CYAN()  { return g_color ? "\033[36m" : ""; }

// Número de puntos de código UTF-8 (para alinear y ajustar texto)
inline size_t uwidth(const std::string& s) {
    size_t n = 0;
    for (unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

// Corta una cadena UTF-8 a n puntos de código
inline std::string utrunc(const std::string& s, size_t n) {
    size_t count = 0, i = 0;
    for (; i < s.size(); ++i) {
        if ((static_cast<unsigned char>(s[i]) & 0xC0) != 0x80) {
            if (count == n) break;
            ++count;
        }
    }
    return s.substr(0, i);
}

// Rellena a la derecha hasta `n` puntos de código (printf %-Ns cuenta bytes,
// lo que descuadra las columnas en cuanto hay acentos)
inline std::string upad(const std::string& s, size_t n) {
    std::string t = uwidth(s) > n ? utrunc(s, n) : s;
    size_t w = uwidth(t);
    if (w < n) t.append(n - w, ' ');
    return t;
}

// Ajuste de línea respetando palabras y UTF-8
inline std::vector<std::string> wrap(const std::string& text, size_t width) {
    std::vector<std::string> lines;
    std::istringstream para(text);
    std::string rawline;
    bool any = false;
    while (std::getline(para, rawline)) {
        any = true;
        std::istringstream iss(rawline);
        std::string word, cur;
        size_t curw = 0;
        while (iss >> word) {
            size_t ww = uwidth(word);
            if (curw == 0) {
                cur = word;
                curw = ww;
            } else if (curw + 1 + ww <= width) {
                cur += " " + word;
                curw += 1 + ww;
            } else {
                lines.push_back(cur);
                cur = word;
                curw = ww;
            }
            // palabra más larga que el ancho: se parte
            while (curw > width) {
                lines.push_back(utrunc(cur, width));
                std::string rest = cur.substr(utrunc(cur, width).size());
                cur = rest;
                curw = uwidth(cur);
            }
        }
        lines.push_back(cur);
    }
    if (!any) lines.push_back("");
    return lines;
}

inline size_t screenWidth() {
    const char* c = std::getenv("COLUMNS");
    if (c) {
        try {
            long v = std::stol(c);
            if (v >= 40 && v <= 200) return static_cast<size_t>(v);
        } catch (...) {}
    }
    return 92;
}

inline void printWrapped(const std::string& text, const std::string& indent = "",
                         size_t width = 0) {
    if (width == 0) {
        size_t sw = screenWidth();
        size_t ind = uwidth(indent);
        width = sw > ind + 10 ? sw - ind : 60;
    }
    for (const auto& l : wrap(text, width))
        std::cout << indent << l << "\n";
}

inline void rule(char c = '-') {
    std::cout << term::DIM() << std::string(screenWidth(), c) << term::RESET() << "\n";
}

inline void header(const std::string& title) {
    std::cout << "\n" << BOLD() << CYAN() << title << RESET() << "\n";
    rule('=');
}

// Lee una sola tecla sin necesidad de Enter (si es un TTY)
inline int readKey() {
#if ASORC_POSIX
    if (isatty(STDIN_FILENO)) {
        termios oldt{}, newt{};
        if (tcgetattr(STDIN_FILENO, &oldt) == 0) {
            newt = oldt;
            newt.c_lflag &= static_cast<tcflag_t>(~(ICANON | ECHO));
            newt.c_cc[VMIN] = 1;
            newt.c_cc[VTIME] = 0;
            tcsetattr(STDIN_FILENO, TCSANOW, &newt);
            int ch = std::getchar();
            tcsetattr(STDIN_FILENO, TCSANOW, &oldt);
            return ch;
        }
    }
#endif
    int ch = std::getchar();
    return ch;
}

inline bool stdinIsTty() {
#if ASORC_POSIX
    return isatty(STDIN_FILENO) != 0;
#else
    return true;
#endif
}

inline void pause(const std::string& msg = "Pulsa una tecla para continuar…") {
    std::cout << "\n" << DIM() << msg << RESET() << std::flush;
    if (stdinIsTty()) {
        int c = readKey();
        if (c == EOF) { std::cout << "\n"; return; }
    } else {
        // Sin terminal (entrada por tubería o script) se consume una línea entera,
        // así no queda un salto de línea suelto que se tomaría como respuesta vacía.
        std::string dummy;
        if (!std::getline(std::cin, dummy)) { std::cout << "\n"; return; }
    }
    std::cout << "\n";
}

// Lee una línea; devuelve false si EOF
inline bool readLine(std::string& out) {
    if (!std::getline(std::cin, out)) return false;
    while (!out.empty() && (out.back() == '\r' || out.back() == '\n')) out.pop_back();
    return true;
}

inline std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

inline std::string upper(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

}  // namespace term

// =====================================================================
//  3. Modelo de datos
// =====================================================================
// Idioma con el que se muestra el contenido
enum class Lang { ES, EN, BI };

inline const char* langName(Lang l) {
    switch (l) {
        case Lang::ES: return "español";
        case Lang::EN: return "original (inglés)";
        case Lang::BI: return "bilingüe";
    }
    return "?";
}

struct Option {
    std::string label;   // etiqueta original del libro (A..E)
    std::string text;    // texto original del libro
    std::string textEs;  // traducción al español (vacío = sin traducción)

    const std::string& in(Lang l) const {
        return (l == Lang::EN || textEs.empty()) ? text : textEs;
    }
};

struct AsorcInfo {
    bool eligible = false;
    std::vector<std::string> keptLabels;   // etiquetas originales conservadas
    std::string correctLabel;              // etiqueta original correcta
    std::string question;                  // enunciado para modo ASORC
    std::string questionEs;                // idem, en español
    std::string reason;                    // motivo si no es elegible

    const std::string& stem(Lang l) const {
        return (l == Lang::EN || questionEs.empty()) ? question : questionEs;
    }
};

struct Question {
    std::string id, book, bookTitle, page, chapter, topic, section, type;
    int chapterNo = 0;
    std::string text;                      // enunciado literal del libro
    std::string textEs;                    // traducción al español
    std::vector<Option> options;           // opciones originales (+ traducción)
    std::vector<std::string> correct;      // etiquetas correctas (cerradas)
    std::string correctText;               // respuesta literal (abiertas)
    std::string correctTextEs;
    std::string explanation, explanationEs;
    std::string sourceAnswer, modelAnswer, modelAnswerEs, language;
    bool translated = false;               // true si tiene traducción añadida
    AsorcInfo asorc;

    bool isOpen()   const { return type == "open"; }
    bool isMulti()  const { return type == "multiple_response"; }
    bool isSingle() const { return type == "multiple_choice"; }

    const std::string& stem(Lang l) const {
        return (l == Lang::EN || textEs.empty()) ? text : textEs;
    }
    const std::string& expl(Lang l) const {
        return (l == Lang::EN || explanationEs.empty()) ? explanation : explanationEs;
    }
    const std::string& model(Lang l) const {
        return (l == Lang::EN || modelAnswerEs.empty()) ? modelAnswer : modelAnswerEs;
    }
    const std::string& fill(Lang l) const {
        return (l == Lang::EN || correctTextEs.empty()) ? correctText : correctTextEs;
    }
    // ¿tiene sentido ofrecer la alternancia en esta pregunta?
    bool bilingual() const { return translated && !textEs.empty(); }
};

struct Progress {
    long seen = 0, correct = 0, wrong = 0, blank = 0, partial = 0;
    std::string lastAnswer;
    std::string lastResult;    // correct | wrong | blank | partial
};

// =====================================================================
//  4. Carga del banco de preguntas
// =====================================================================
static std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("No se puede abrir el archivo: " + path);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

static std::string getStr(const json::Value& v, const char* key, const std::string& def = "") {
    const json::Value* p = v.find(key);
    if (!p) return def;
    if (p->type == json::Type::String) return p->str;
    if (p->type == json::Type::Number) {
        double d = p->num;
        if (d == static_cast<long long>(d)) return std::to_string(static_cast<long long>(d));
    }
    return def;
}

static std::vector<Question> loadQuestions(const std::string& path, json::Value& rootOut) {
    std::string raw = readFile(path);
    json::Parser p(raw);
    rootOut = p.parse();
    const json::Value* qs = rootOut.find("questions");
    if (!qs || !qs->isArray())
        throw std::runtime_error("questions.json no contiene un array 'questions'");

    std::vector<Question> out;
    out.reserve(qs->items().size());
    for (const auto& jv : qs->items()) {
        Question q;
        q.id         = getStr(jv, "id");
        q.book       = getStr(jv, "book");
        q.bookTitle  = getStr(jv, "book_title");
        q.page       = getStr(jv, "page");
        q.chapter    = getStr(jv, "chapter");
        q.topic      = getStr(jv, "topic");
        q.section    = getStr(jv, "section");
        q.type       = getStr(jv, "type");
        q.text       = getStr(jv, "question");
        q.explanation  = getStr(jv, "explanation");
        q.sourceAnswer = getStr(jv, "source_answer");
        q.modelAnswer  = getStr(jv, "model_answer");
        q.language     = getStr(jv, "language");
        if (const json::Value* c = jv.find("chapter_no")) q.chapterNo = static_cast<int>(c->asInt());

        if (const json::Value* o = jv.find("original_options")) {
            for (const auto& ov : o->items()) {
                Option op;
                op.label = getStr(ov, "label");
                op.text  = getStr(ov, "text");
                q.options.push_back(op);
            }
        }
        // Traducción paralela: misma longitud y mismas etiquetas (lo garantiza
        // merge_es.py); si no cuadra, se ignora en vez de desalinear opciones.
        if (const json::Value* oe = jv.find("original_options_es")) {
            const auto& items = oe->items();
            if (items.size() == q.options.size()) {
                bool aligned = true;
                for (size_t i = 0; i < items.size(); ++i)
                    if (getStr(items[i], "label") != q.options[i].label) aligned = false;
                if (aligned)
                    for (size_t i = 0; i < items.size(); ++i)
                        q.options[i].textEs = getStr(items[i], "text");
            }
        }
        q.textEs         = getStr(jv, "question_es");
        q.explanationEs  = getStr(jv, "explanation_es");
        q.modelAnswerEs  = getStr(jv, "model_answer_es");
        q.correctTextEs  = getStr(jv, "correct_answer_es");
        if (const json::Value* t = jv.find("translated")) q.translated = t->asBool();
        if (const json::Value* ca = jv.find("correct_answer")) {
            if (ca->isArray())
                for (const auto& e : ca->items()) q.correct.push_back(e.asString());
            else if (ca->type == json::Type::String)
                q.correctText = ca->str;
        }
        if (q.modelAnswer.empty() && q.isOpen()) q.modelAnswer = q.sourceAnswer;

        if (const json::Value* a = jv.find("asorc")) {
            if (const json::Value* e = a->find("eligible")) q.asorc.eligible = e->asBool();
            q.asorc.correctLabel = getStr(*a, "correct_label");
            q.asorc.question     = getStr(*a, "question", q.text);
            q.asorc.questionEs   = getStr(*a, "question_es");
            q.asorc.reason       = getStr(*a, "reason");
            if (const json::Value* k = a->find("kept_option_labels"))
                for (const auto& e : k->items()) q.asorc.keptLabels.push_back(e.asString());
        }
        if (q.asorc.question.empty()) q.asorc.question = q.text;
        if (q.asorc.questionEs.empty()) q.asorc.questionEs = q.textEs;
        if (q.modelAnswerEs.empty() && q.isOpen()) q.modelAnswerEs = q.explanationEs;
        out.push_back(std::move(q));
    }
    return out;
}

// =====================================================================
//  5. Progreso persistente
// =====================================================================
class Store {
public:
    explicit Store(std::string path) : path_(std::move(path)) { load(); }

    Progress& at(const std::string& id) { return data_[id]; }

    const std::string& lang() const { return lang_; }
    void setLang(const std::string& l) {
        if (l != lang_) { lang_ = l; dirty_ = true; save(); }
    }
    const std::map<std::string, Progress>& all() const { return data_; }

    bool seenBefore(const std::string& id) const {
        auto it = data_.find(id);
        return it != data_.end() && it->second.seen > 0;
    }
    bool failedBefore(const std::string& id) const {
        auto it = data_.find(id);
        if (it == data_.end()) return false;
        return it->second.wrong > 0 || it->second.partial > 0;
    }

    void record(const std::string& id, const std::string& result, const std::string& answer) {
        Progress& p = data_[id];
        p.seen++;
        if (result == "correct") p.correct++;
        else if (result == "wrong") p.wrong++;
        else if (result == "blank") p.blank++;
        else if (result == "partial") p.partial++;
        p.lastAnswer = answer;
        p.lastResult = result;
        dirty_ = true;
    }

    void save() {
        if (!dirty_) return;
        json::Value root = json::Value::makeObject();
        root.set("schema_version", json::Value::make(1.0));
        root.set("app", json::Value::make(std::string("test-ASORC")));
        json::Value qs = json::Value::makeObject();
        for (const auto& kv : data_) {
            const Progress& p = kv.second;
            json::Value e = json::Value::makeObject();
            e.set("veces_vista", json::Value::make(static_cast<double>(p.seen)));
            e.set("aciertos",    json::Value::make(static_cast<double>(p.correct)));
            e.set("fallos",      json::Value::make(static_cast<double>(p.wrong)));
            e.set("blancos",     json::Value::make(static_cast<double>(p.blank)));
            e.set("parciales",   json::Value::make(static_cast<double>(p.partial)));
            e.set("ultima_respuesta", json::Value::make(p.lastAnswer));
            e.set("ultimo_resultado", json::Value::make(p.lastResult));
            qs.set(kv.first, e);
        }
        root.set("preguntas", qs);
        json::Value cfg = json::Value::makeObject();
        cfg.set("idioma", json::Value::make(lang_));
        root.set("configuracion", cfg);
        std::string tmp = path_ + ".tmp";
        {
            std::ofstream f(tmp, std::ios::binary);
            if (!f) { std::cerr << "Aviso: no se pudo escribir " << tmp << "\n"; return; }
            f << json::serialize(root) << "\n";
        }
        std::remove(path_.c_str());
        if (std::rename(tmp.c_str(), path_.c_str()) != 0)
            std::cerr << "Aviso: no se pudo renombrar el archivo de progreso\n";
        dirty_ = false;
    }

private:
    void load() {
        std::ifstream f(path_, std::ios::binary);
        if (!f) return;
        std::ostringstream ss;
        ss << f.rdbuf();
        std::string raw = ss.str();
        if (term::trim(raw).empty()) return;
        try {
            json::Parser p(raw);
            json::Value root = p.parse();
            if (const json::Value* cfg = root.find("configuracion")) {
                std::string l = getStr(*cfg, "idioma");
                if (l == "es" || l == "en" || l == "bi") lang_ = l;
            }
            const json::Value* qs = root.find("preguntas");
            if (!qs || !qs->isObject()) return;
            for (const auto& kv : qs->members()) {
                Progress pr;
                const json::Value& e = kv.second;
                if (const json::Value* v = e.find("veces_vista")) pr.seen    = v->asInt();
                if (const json::Value* v = e.find("aciertos"))    pr.correct = v->asInt();
                if (const json::Value* v = e.find("fallos"))      pr.wrong   = v->asInt();
                if (const json::Value* v = e.find("blancos"))     pr.blank   = v->asInt();
                if (const json::Value* v = e.find("parciales"))   pr.partial = v->asInt();
                pr.lastAnswer = getStr(e, "ultima_respuesta");
                pr.lastResult = getStr(e, "ultimo_resultado");
                data_[kv.first] = pr;
            }
        } catch (const std::exception& ex) {
            std::cerr << term::YEL() << "Aviso: progress.json ilegible (" << ex.what()
                      << "). Se empieza de cero.\n" << term::RESET();
        }
    }

    std::string path_;
    std::map<std::string, Progress> data_;
    std::string lang_ = "es";       // es | en | bi
    bool dirty_ = false;
};

// =====================================================================
//  6. Presentación y resolución de preguntas
// =====================================================================
static std::mt19937& rng() {
    static std::mt19937 g(static_cast<uint32_t>(
        std::chrono::steady_clock::now().time_since_epoch().count()));
    return g;
}

struct AskResult {
    std::string result;    // correct | wrong | blank | partial | quit
    std::string answer;
    bool paused = false;   // la función ya pidió la tecla para continuar
};

static std::string bookLabel(const Question& q) {
    if (q.book == "sybex") return "Sybex (EN)";
    if (q.book == "eni")   return "ENI (ES)";
    return q.book;
}

static Lang g_lang = Lang::ES;          // idioma configurado para la sesión

// 't' alterna español <-> original inglés (desde bilingüe entra en español)
static Lang toggleLang(Lang l) { return l == Lang::ES ? Lang::EN : Lang::ES; }

static void printWrappedDim(const std::string& t, const std::string& indent) {
    size_t w = term::screenWidth();
    size_t ind = term::uwidth(indent);
    for (const auto& ln : term::wrap(t, w > ind + 10 ? w - ind : 60))
        std::cout << indent << term::DIM() << ln << term::RESET() << "\n";
}

// Muestra un texto según el idioma; en bilingüe pone el español y debajo el
// original atenuado (se omite si ambos coinciden, p.ej. un comando).
static void printBiText(const std::string& es, const std::string& en, Lang l,
                        const std::string& indent = "  ") {
    if (l == Lang::BI && !es.empty() && es != en) {
        term::printWrapped(es, indent);
        printWrappedDim(en, indent);
    } else {
        term::printWrapped((l == Lang::EN || es.empty()) ? en : es, indent);
    }
}

static void printQuestionHeader(const Question& q, size_t idx, size_t total,
                                const std::string& modeTag, Lang l) {
    std::cout << "\n";
    term::rule('=');
    std::cout << term::BOLD() << "Pregunta " << idx << "/" << total << term::RESET()
              << term::DIM() << "   [" << q.id << "]  " << bookLabel(q)
              << "  ·  pág. " << q.page;
    if (!modeTag.empty()) std::cout << "  ·  " << modeTag;
    std::cout << "  ·  " << langName(l);
    std::cout << term::RESET() << "\n";
    std::cout << term::DIM() << q.chapter << "  ·  tema: " << q.topic
              << term::RESET() << "\n";
    term::rule('-');
}

// Las opciones se barajan, así que las referencias «option C» del texto del libro
// dejarían de cuadrar con lo que se muestra. Se reescriben a la letra mostrada.
// Para una opción que el modo ASORC no muestra, se cita su texto en vez de la letra.
static std::string remapExplanation(const std::string& expl,
                                    const std::map<std::string, std::string>& origToShown,
                                    const std::map<std::string, std::string>& droppedText) {
    if (expl.empty()) return expl;
    auto mapLetter = [&](const std::string& letter) -> std::string {
        auto it = origToShown.find(letter);
        if (it != origToShown.end()) return it->second;
        auto dt = droppedText.find(letter);
        if (dt != droppedText.end())
            return "«" + term::utrunc(dt->second, 34) + "»";
        return letter;
    };
    // El libro se refiere a las opciones como "option X" / "answer X"; la
    // traducción al español usa "opción X" / "opciones X y Z" / "respuesta X".
    // "opciones" se lista aparte porque el plural de "opción" pierde la tilde.
    static const std::string kWords[] = {"option", "answer",
                                         "opciones", "opción", "respuesta"};
    std::string out;
    out.reserve(expl.size() + 32);
    size_t i = 0;
    while (i < expl.size()) {
        const std::string* hit = nullptr;
        bool boundaryL = (i == 0) || !std::isalnum(static_cast<unsigned char>(expl[i - 1]));
        if (boundaryL) {
            for (const std::string& w : kWords) {
                if (i + w.size() > expl.size()) continue;
                bool eq = true;
                for (size_t k = 0; k < w.size(); ++k) {
                    // Ambos lados como unsigned: los bytes UTF-8 (p.ej. la "ó" de
                    // "opción") son negativos si se comparan como char con signo.
                    unsigned char a = static_cast<unsigned char>(expl[i + k]);
                    unsigned char b = static_cast<unsigned char>(w[k]);
                    if (static_cast<unsigned char>(std::tolower(a)) != b) { eq = false; break; }
                }
                if (eq) { hit = &w; break; }
            }
        }
        if (!hit) { out += expl[i++]; continue; }

        size_t j = i + hit->size();
        if (*hit != "opciones" && j < expl.size() &&
            (expl[j] == 's' || expl[j] == 'S')) ++j;                     // plural
        if (j < expl.size() && std::isalnum(static_cast<unsigned char>(expl[j]))) {
            out += expl[i++];                     // p.ej. "optional": no es una referencia
            continue;
        }
        std::string head = expl.substr(i, j - i);
        // Recorrer la lista de letras: "A", "A and B" / "A y B", "A, B, and C"
        std::string tail;
        size_t k = j;
        bool got = false;
        while (true) {
            size_t save = k;
            std::string sep;
            while (k < expl.size() && (expl[k] == ' ' || expl[k] == ',')) { sep += expl[k]; ++k; }
            if (k + 3 < expl.size() && expl.compare(k, 4, "and ") == 0) { sep += "and "; k += 4; }
            else if (k + 1 < expl.size() && (expl[k] == 'y' || expl[k] == 'Y') &&
                     expl[k + 1] == ' ') { sep += expl[k]; sep += ' '; k += 2; }
            while (k < expl.size() && expl[k] == ' ') { sep += ' '; ++k; }
            if (k < expl.size() && expl[k] >= 'A' && expl[k] <= 'E' &&
                (k + 1 >= expl.size() || !std::isalnum(static_cast<unsigned char>(expl[k + 1])))) {
                char from = expl[k];
                tail += sep + mapLetter(std::string(1, from));
                ++k;
                got = true;
                // rango "A through D": se expande a la lista de letras mostradas
                size_t save2 = k;
                size_t m = k;
                while (m < expl.size() && expl[m] == ' ') ++m;
                if (expl.compare(m, 8, "through ") == 0) {
                    m += 8;
                    while (m < expl.size() && expl[m] == ' ') ++m;
                    if (m < expl.size() && expl[m] >= 'A' && expl[m] <= 'E' &&
                        (m + 1 >= expl.size() ||
                         !std::isalnum(static_cast<unsigned char>(expl[m + 1]))) &&
                        expl[m] > from) {
                        for (char ch = static_cast<char>(from + 1); ch <= expl[m]; ++ch)
                            tail += (ch == expl[m] ? " y " : ", ") + mapLetter(std::string(1, ch));
                        k = m + 1;
                    } else {
                        k = save2;
                    }
                }
                continue;
            }
            k = save;
            break;
        }
        if (!got) { out += expl[i++]; continue; }
        out += head + tail;
        i = k;
    }
    return out;
}

static void printExplanation(const Question& q, Lang l,
                             const std::map<std::string, std::string>& origToShown,
                             const std::map<std::string, std::string>& droppedTextEs,
                             const std::map<std::string, std::string>& droppedTextEn) {
    if (q.explanation.empty()) return;
    std::cout << "\n" << term::BOLD() << "Explicación del libro:" << term::RESET() << "\n";
    std::string es = remapExplanation(q.explanationEs, origToShown, droppedTextEs);
    std::string en = remapExplanation(q.explanation,   origToShown, droppedTextEn);
    printBiText(es, en, l);
    if (!origToShown.empty())
        std::cout << term::DIM()
                  << "  (las letras de la explicación se han ajustado al orden barajado)"
                  << term::RESET() << "\n";
}

static void printLangHint(const Question& q, Lang l) {
    if (q.bilingual())
        std::cout << term::DIM() << "  ['t' = cambiar a "
                  << (l == Lang::EN ? "español" : "original en inglés") << "]"
                  << term::RESET() << "\n";
    else if (l == Lang::EN && q.book == "eni")
        std::cout << term::DIM()
                  << "  (pregunta original en español; este libro no tiene versión inglesa)"
                  << term::RESET() << "\n";
}

// Única pausa de continuación tras corregir. Devuelve true si hay que volver a
// mostrar la pregunta en el otro idioma ('t'); false para pasar a la siguiente.
static bool continuePrompt(const Question& q, Lang lang) {
    std::cout << "\n" << term::DIM();
    if (q.bilingual())
        std::cout << "Pulsa 't' para verla en "
                  << (lang == Lang::EN ? "español" : "el original en inglés")
                  << ", cualquier otra tecla para continuar…";
    else
        std::cout << "Pulsa una tecla para continuar…";
    std::cout << term::RESET() << std::flush;

    int c;
    if (term::stdinIsTty()) {
        c = term::readKey();
    } else {
        std::string line;
        if (!std::getline(std::cin, line)) { std::cout << "\n"; return false; }
        c = line.empty() ? '\n' : line[0];
    }
    std::cout << "\n";
    return q.bilingual() && (c == 't' || c == 'T');
}

// --------- Pregunta cerrada (opción múltiple / respuesta múltiple) ---------
// asorcMode: usa solo las 3 opciones seleccionadas y exige una sola respuesta.
static AskResult askClosed(const Question& q, size_t idx, size_t total,
                           bool asorcMode, const std::string& modeTag,
                           bool allowPause) {
    Lang lang = g_lang;

    // Construir la lista de opciones a mostrar (se baraja UNA sola vez: al
    // cambiar de idioma debe mantenerse el mismo orden en pantalla)
    std::vector<Option> shown;
    if (asorcMode) {
        for (const auto& lbl : q.asorc.keptLabels)
            for (const auto& o : q.options)
                if (o.label == lbl) shown.push_back(o);
    } else {
        shown = q.options;
    }
    std::shuffle(shown.begin(), shown.end(), rng());

    const std::string letters = "ABCDEFGH";
    std::map<char, std::string> shownToOrig;          // mostrada -> original
    for (size_t i = 0; i < shown.size(); ++i) shownToOrig[letters[i]] = shown[i].label;

    std::vector<char> correctShown;
    for (size_t i = 0; i < shown.size(); ++i) {
        bool isCorrect = asorcMode ? (shown[i].label == q.asorc.correctLabel)
                                   : (std::find(q.correct.begin(), q.correct.end(),
                                                shown[i].label) != q.correct.end());
        if (isCorrect) correctShown.push_back(letters[i]);
    }
    std::sort(correctShown.begin(), correctShown.end());

    bool multi = !asorcMode && q.isMulti();
    std::vector<char> given;
    std::string result;

    // ---- bucle de presentación: 't' redibuja en el otro idioma ----
    while (true) {
        printQuestionHeader(q, idx, total, modeTag, lang);
        const std::string& stemEs = asorcMode ? q.asorc.questionEs : q.textEs;
        const std::string& stemEn = asorcMode ? q.asorc.question   : q.text;
        printBiText(stemEs, stemEn, lang);
        std::cout << "\n";
        for (size_t i = 0; i < shown.size(); ++i) {
            std::string prefix = std::string("  ") + term::BOLD() + letters[i] + term::RESET() + ". ";
            const std::string& oes = shown[i].textEs;
            const std::string& oen = shown[i].text;
            const std::string& main = (lang == Lang::EN || oes.empty()) ? oen : oes;
            auto lines = term::wrap(main, term::screenWidth() - 6);
            for (size_t k = 0; k < lines.size(); ++k)
                std::cout << (k == 0 ? prefix : "     ") << lines[k] << "\n";
            if (lang == Lang::BI && !oes.empty() && oes != oen)
                printWrappedDim(oen, "     ");
        }

        std::cout << "\n";
        if (multi)
            std::cout << term::YEL()
                      << "  (Varias respuestas correctas: escribe todas las letras, p.ej. ACE)"
                      << term::RESET() << "\n";
        if (asorcMode)
            std::cout << term::DIM() << "  Modo ASORC · 3 opciones · una sola respuesta correcta"
                      << "  ·  Enter = en blanco" << term::RESET() << "\n";
        printLangHint(q, lang);
        std::cout << "\n" << term::BOLD() << "Tu respuesta" << term::RESET()
                  << " (Enter=en blanco, 't'=idioma, 'q'=salir del modo): ";
        std::cout.flush();

        std::string line;
        if (!term::readLine(line)) return {"quit", ""};
        line = term::trim(line);
        std::string up = term::upper(line);
        if (up == "Q") return {"quit", ""};
        if (up == "T") {
            if (q.bilingual()) lang = toggleLang(lang);
            else std::cout << term::DIM()
                           << "  (esta pregunta no tiene traducción alternativa)"
                           << term::RESET() << "\n";
            continue;
        }

        given.clear();
        for (char c : up) {
            if (c >= 'A' && c < static_cast<char>('A' + shown.size()))
                if (std::find(given.begin(), given.end(), c) == given.end())
                    given.push_back(c);
        }
        std::sort(given.begin(), given.end());
        if (given.empty()) result = "blank";
        else if (given == correctShown) result = "correct";
        else result = "wrong";
        break;
    }

    std::map<std::string, std::string> origToShown, droppedEs, droppedEn;
    for (const auto& kv : shownToOrig) origToShown[kv.second] = std::string(1, kv.first);
    for (const auto& o : q.options)
        if (!origToShown.count(o.label)) {
            droppedEn[o.label] = o.text;
            droppedEs[o.label] = o.textEs.empty() ? o.text : o.textEs;
        }

    // ---- bucle de corrección: 't' vuelve a mostrarla en el otro idioma ----
    while (true) {
        std::cout << "\n";
        if (result == "correct")
            std::cout << term::GREEN() << term::BOLD() << "  ✔ CORRECTO" << term::RESET() << "\n";
        else if (result == "blank")
            std::cout << term::YEL() << term::BOLD() << "  ○ EN BLANCO" << term::RESET() << "\n";
        else
            std::cout << term::RED() << term::BOLD() << "  ✘ INCORRECTO" << term::RESET() << "\n";

        std::string correctStr;
        for (size_t i = 0; i < correctShown.size(); ++i) {
            if (i) correctStr += ", ";
            correctStr += correctShown[i];
        }
        std::cout << "  Respuesta correcta: " << term::GREEN() << term::BOLD()
                  << correctStr << term::RESET() << "\n";
        for (char c : correctShown) {
            for (size_t i = 0; i < shown.size(); ++i)
                if (letters[i] == c) {
                    const std::string& oes = shown[i].textEs;
                    const std::string& main =
                        (lang == Lang::EN || oes.empty()) ? shown[i].text : oes;
                    auto lines = term::wrap(main, term::screenWidth() - 8);
                    for (size_t k = 0; k < lines.size(); ++k)
                        std::cout << (k == 0 ? "     → " : "       ") << lines[k] << "\n";
                    if (lang == Lang::BI && !oes.empty() && oes != shown[i].text)
                        printWrappedDim(shown[i].text, "       ");
                }
        }
        std::vector<std::string> origLabels;
        for (char c : correctShown) origLabels.push_back(shownToOrig[c]);
        std::sort(origLabels.begin(), origLabels.end());
        std::string origStr;
        for (size_t i = 0; i < origLabels.size(); ++i) {
            if (i) origStr += ", ";
            origStr += origLabels[i];
        }
        std::cout << term::DIM() << "  (en el libro: opción " << origStr
                  << ", " << q.chapter << ", pág. " << q.page << ")" << term::RESET() << "\n";

        printExplanation(q, lang, origToShown, droppedEs, droppedEn);

        if (!allowPause) break;
        if (!continuePrompt(q, lang)) break;
        lang = toggleLang(lang);
    }

    std::string origGiven;
    for (char c : given) {
        if (!origGiven.empty()) origGiven += ",";
        origGiven += shownToOrig[c];
    }
    return {result, origGiven.empty() ? std::string("(en blanco)") : origGiven, allowPause};
}

// --------------------------- Pregunta abierta ---------------------------
static AskResult askOpen(const Question& q, size_t idx, size_t total,
                         const std::string& modeTag, bool allowPause) {
    Lang lang = g_lang;
    std::string answer;

    while (true) {
        printQuestionHeader(q, idx, total, modeTag, lang);
        printBiText(q.textEs, q.text, lang);
        printLangHint(q, lang);
        std::cout << "\n" << term::DIM()
                  << "  Escribe tu respuesta. Línea vacía para terminar; en la primera línea "
                     "'t' = idioma, 'q' = salir."
                  << term::RESET() << "\n";

        answer.clear();
        std::string line;
        bool first = true, retoggle = false;
        while (true) {
            std::cout << "  > ";
            std::cout.flush();
            if (!term::readLine(line)) { if (first) return {"quit", ""}; break; }
            std::string up = term::upper(term::trim(line));
            if (first && up == "Q") return {"quit", ""};
            if (first && up == "T") {
                if (q.bilingual()) { lang = toggleLang(lang); retoggle = true; break; }
                std::cout << term::DIM() << "  (sin traducción alternativa)"
                          << term::RESET() << "\n";
                continue;
            }
            if (term::trim(line).empty()) break;
            if (!answer.empty()) answer += "\n";
            answer += line;
            first = false;
        }
        if (retoggle) continue;
        break;
    }

    // ---- respuesta modelo (con alternancia de idioma) ----
    while (true) {
        std::cout << "\n" << term::BOLD() << term::CYAN() << "Respuesta modelo del libro:"
                  << term::RESET() << "\n";
        const std::string& fillEs = q.correctTextEs;
        const std::string& fillEn = q.correctText;
        if (!fillEn.empty() && q.book == "sybex") {
            const std::string& f = (lang == Lang::EN || fillEs.empty()) ? fillEn : fillEs;
            std::cout << "  " << term::GREEN() << term::BOLD() << f << term::RESET() << "\n\n";
        }
        const std::string& mEn = !q.modelAnswer.empty() ? q.modelAnswer : q.sourceAnswer;
        const std::string& mEs = q.modelAnswerEs;
        printBiText(mEs, mEn, lang);
        std::cout << term::DIM() << "\n  (" << q.chapter << ", pág. " << q.page << ")"
                  << term::RESET() << "\n";

        break;   // la pausa de la abierta va tras la autocalificación
    }

    if (term::trim(answer).empty()) {
        std::cout << "\n" << term::YEL() << "  ○ No has escrito respuesta → cuenta como EN BLANCO."
                  << term::RESET() << "\n";
        if (allowPause) while (continuePrompt(q, lang)) {}
        return {"blank", "", allowPause};
    }

    std::cout << "\n" << term::BOLD() << "¿Cómo te puntúas?" << term::RESET()
              << "  [" << term::GREEN() << "B" << term::RESET() << "]ien  ["
              << term::YEL() << "P" << term::RESET() << "]arcial  ["
              << term::RED() << "M" << term::RESET() << "]al  (Enter = Parcial): ";
    std::cout.flush();
    std::string g;
    if (!term::readLine(g)) return {"partial", answer, false};
    std::string gg = term::upper(term::trim(g));
    std::string result = "partial";
    if (gg == "B") result = "correct";
    else if (gg == "M") result = "wrong";
    else if (gg == "P" || gg.empty()) result = "partial";

    std::cout << "  Registrado como: ";
    if (result == "correct") std::cout << term::GREEN() << "BIEN";
    else if (result == "wrong") std::cout << term::RED() << "MAL";
    else std::cout << term::YEL() << "PARCIAL";
    std::cout << term::RESET() << "\n";
    if (allowPause) while (continuePrompt(q, lang)) {}
    return {result, answer, allowPause};
}

// =====================================================================
//  7. Sesiones de estudio
// =====================================================================
struct SessionStats {
    long correct = 0, wrong = 0, blank = 0, partial = 0;
    std::map<std::string, std::pair<long, long>> byTopic;   // tema -> (fallos, total)

    void add(const std::string& topic, const std::string& res) {
        if (res == "correct") correct++;
        else if (res == "wrong") wrong++;
        else if (res == "blank") blank++;
        else if (res == "partial") partial++;
        auto& t = byTopic[topic];
        t.second++;
        if (res == "wrong" || res == "partial") t.first++;
    }
    long answered() const { return correct + wrong + partial; }
    long total() const { return correct + wrong + blank + partial; }
};

static void printTopicBreakdown(const SessionStats& st, const char* title) {
    std::vector<std::pair<std::string, std::pair<long, long>>> v(st.byTopic.begin(),
                                                                 st.byTopic.end());
    std::sort(v.begin(), v.end(), [](const auto& a, const auto& b) {
        double ra = a.second.second ? static_cast<double>(a.second.first) / static_cast<double>(a.second.second) : 0.0;
        double rb = b.second.second ? static_cast<double>(b.second.first) / static_cast<double>(b.second.second) : 0.0;
        if (ra != rb) return ra > rb;
        return a.second.first > b.second.first;
    });
    bool anyFail = std::any_of(v.begin(), v.end(),
                               [](const auto& p) { return p.second.first > 0; });
    if (!anyFail) return;
    std::cout << "\n" << term::BOLD() << title << term::RESET() << "\n";
    for (const auto& p : v) {
        if (p.second.first == 0) continue;
        double pct = 100.0 * static_cast<double>(p.second.first) /
                     static_cast<double>(p.second.second);
        int bars = static_cast<int>(pct / 5.0);
        std::cout << "  " << term::RED() << std::string(static_cast<size_t>(bars), '#')
                  << term::RESET() << std::string(static_cast<size_t>(20 - bars), ' ')
                  << "  " << p.second.first << "/" << p.second.second
                  << "  (" << static_cast<int>(pct + 0.5) << "%)  " << p.first << "\n";
    }
}

static void runSession(std::vector<Question*> qs, Store& store, bool asorcMode,
                       const std::string& modeTag) {
    if (qs.empty()) {
        std::cout << "\n" << term::YEL()
                  << "No hay preguntas que cumplan ese criterio." << term::RESET() << "\n";
        term::pause();
        return;
    }
    std::shuffle(qs.begin(), qs.end(), rng());

    SessionStats st;
    size_t total = qs.size();
    size_t i = 0;
    bool quit = false;
    for (; i < total && !quit; ++i) {
        Question& q = *qs[i];
        bool allowPause = (i + 1 < total);
        AskResult r = q.isOpen() ? askOpen(q, i + 1, total, modeTag, allowPause)
                                 : askClosed(q, i + 1, total, asorcMode, modeTag, allowPause);
        if (r.result == "quit") { quit = true; break; }
        store.record(q.id, r.result, r.answer);
        st.add(q.topic, r.result);
        store.save();
        if (allowPause && !r.paused) term::pause();
    }

    // ---------------- Resumen ----------------
    term::header(asorcMode ? "Resultado del simulacro ASORC" : "Resumen de la sesión");
    long done = st.total();
    std::cout << "  Preguntas realizadas : " << done << " de " << total << "\n";
    std::cout << "  " << term::GREEN() << "Correctas" << term::RESET() << "            : " << st.correct << "\n";
    std::cout << "  " << term::RED()   << "Incorrectas" << term::RESET() << "          : " << st.wrong << "\n";
    if (st.partial)
        std::cout << "  " << term::YEL() << "Parciales" << term::RESET() << "            : " << st.partial << "\n";
    std::cout << "  " << term::YEL()   << "En blanco" << term::RESET() << "            : " << st.blank << "\n";

    if (asorcMode) {
        double net = static_cast<double>(st.correct) - 0.5 * static_cast<double>(st.wrong);
        double pct = done > 0 ? (net / static_cast<double>(done)) * 100.0 : 0.0;
        term::rule('-');
        std::cout << "  " << term::BOLD() << "Puntuación neta" << term::RESET()
                  << "      : " << term::BOLD();
        std::printf("%.2f", net);
        std::cout << term::RESET() << " / " << done
                  << term::DIM() << "   (correcta +1 · incorrecta -0,5 · blanco 0)"
                  << term::RESET() << "\n";
        std::cout << "  " << term::BOLD() << "Porcentaje" << term::RESET() << "           : ";
        const char* col = pct >= 50.0 ? term::GREEN() : term::RED();
        std::cout << col << term::BOLD();
        std::printf("%.1f%%", pct);
        std::cout << term::RESET() << "\n";
        std::cout << "  Veredicto            : "
                  << (pct >= 50.0 ? std::string(term::GREEN()) + "APTO"
                                  : std::string(term::RED()) + "NO APTO")
                  << term::RESET() << term::DIM() << "  (umbral orientativo 50%)"
                  << term::RESET() << "\n";
    } else if (done > 0) {
        double pct = 100.0 * static_cast<double>(st.correct) / static_cast<double>(done);
        std::cout << "  Porcentaje de acierto: ";
        std::printf("%.1f%%", pct);
        std::cout << "\n";
    }

    printTopicBreakdown(st, "Temas donde más fallo:");
    store.save();
    term::pause();
}

// =====================================================================
//  8. Menús y filtros
// =====================================================================
static std::vector<Question*> ptrs(std::vector<Question>& all) {
    std::vector<Question*> v;
    v.reserve(all.size());
    for (auto& q : all) v.push_back(&q);
    return v;
}

template <typename Pred>
static std::vector<Question*> filter(std::vector<Question>& all, Pred p) {
    std::vector<Question*> v;
    for (auto& q : all)
        if (p(q)) v.push_back(&q);
    return v;
}

static int readMenuChoice(const std::string& prompt, int lo, int hi, bool& eof) {
    while (true) {
        std::cout << "\n" << term::BOLD() << prompt << term::RESET() << " ";
        std::cout.flush();
        std::string line;
        if (!term::readLine(line)) { eof = true; return -1; }
        line = term::trim(line);
        if (line.empty()) continue;
        if (term::upper(line) == "Q") return -1;
        try {
            int v = std::stoi(line);
            if (v >= lo && v <= hi) return v;
        } catch (...) {}
        std::cout << term::RED() << "  Opción no válida." << term::RESET() << "\n";
    }
}

static void modeByBook(std::vector<Question>& all, Store& store) {
    std::vector<std::string> books;
    for (const auto& q : all)
        if (std::find(books.begin(), books.end(), q.book) == books.end())
            books.push_back(q.book);
    term::header("Elegir libro");
    for (size_t i = 0; i < books.size(); ++i) {
        long n = std::count_if(all.begin(), all.end(),
                               [&](const Question& q) { return q.book == books[i]; });
        std::string title;
        for (const auto& q : all)
            if (q.book == books[i]) { title = q.bookTitle; break; }
        std::cout << "  " << term::BOLD() << (i + 1) << term::RESET() << ". ";
        std::cout << term::CYAN() << (books[i] == "sybex" ? "Sybex (inglés)" : "ENI (español)")
                  << term::RESET() << "  " << term::DIM() << "(" << n << " preguntas)"
                  << term::RESET() << "\n";
        term::printWrapped(title, "       " , term::screenWidth() - 8);
    }
    bool eof = false;
    int c = readMenuChoice("Libro (número, q=volver):", 1, static_cast<int>(books.size()), eof);
    if (c < 0) return;
    const std::string& b = books[static_cast<size_t>(c - 1)];
    runSession(filter(all, [&](const Question& q) { return q.book == b; }), store, false,
               "por libro");
}

static void modeByChapterOrTopic(std::vector<Question>& all, Store& store) {
    term::header("Por capítulo / tema");
    std::cout << "  " << term::BOLD() << "1" << term::RESET() << ". Elegir por TEMA (agrupa los dos libros)\n";
    std::cout << "  " << term::BOLD() << "2" << term::RESET() << ". Elegir por CAPÍTULO de un libro\n";
    bool eof = false;
    int c = readMenuChoice("Opción (q=volver):", 1, 2, eof);
    if (c < 0) return;

    if (c == 1) {
        std::vector<std::string> topics;
        for (const auto& q : all)
            if (std::find(topics.begin(), topics.end(), q.topic) == topics.end())
                topics.push_back(q.topic);
        std::sort(topics.begin(), topics.end());
        term::header("Temas");
        for (size_t i = 0; i < topics.size(); ++i) {
            long n = std::count_if(all.begin(), all.end(),
                                   [&](const Question& q) { return q.topic == topics[i]; });
            std::printf("  %2zu. %s %s(%ld preguntas)%s\n", i + 1,
                        term::upad(topics[i], 46).c_str(), term::DIM(), n, term::RESET());
        }
        int t = readMenuChoice("Tema (número, q=volver):", 1, static_cast<int>(topics.size()), eof);
        if (t < 0) return;
        const std::string& tp = topics[static_cast<size_t>(t - 1)];
        runSession(filter(all, [&](const Question& q) { return q.topic == tp; }), store, false,
                   "tema");
    } else {
        std::vector<std::string> chapters;
        for (const auto& q : all)
            if (std::find(chapters.begin(), chapters.end(), q.chapter) == chapters.end())
                chapters.push_back(q.chapter);
        term::header("Capítulos");
        for (size_t i = 0; i < chapters.size(); ++i) {
            long n = std::count_if(all.begin(), all.end(),
                                   [&](const Question& q) { return q.chapter == chapters[i]; });
            std::string src;
            for (const auto& q : all)
                if (q.chapter == chapters[i]) { src = bookLabel(q); break; }
            std::printf("  %2zu. %s %s%s %2ld q.%s\n", i + 1,
                        term::upad(chapters[i], 52).c_str(), term::DIM(),
                        term::upad(src, 11).c_str(), n, term::RESET());
        }
        int t = readMenuChoice("Capítulo (número, q=volver):", 1,
                               static_cast<int>(chapters.size()), eof);
        if (t < 0) return;
        const std::string& ch = chapters[static_cast<size_t>(t - 1)];
        runSession(filter(all, [&](const Question& q) { return q.chapter == ch; }), store, false,
                   "capítulo");
    }
}

static void modeAsorc(std::vector<Question>& all, Store& store) {
    std::vector<Question*> pool =
        filter(all, [](const Question& q) { return q.asorc.eligible; });
    term::header("Simulacro ASORC");
    std::cout << "  Preguntas disponibles en formato ASORC (3 opciones, 1 respuesta correcta): "
              << term::BOLD() << pool.size() << term::RESET() << "\n";
    std::cout << term::DIM()
              << "  Puntuación: correcta +1 · incorrecta -0,5 · en blanco 0\n"
              << "  (2 respuestas incorrectas anulan 1 correcta)\n" << term::RESET();
    long excluded = std::count_if(all.begin(), all.end(), [](const Question& q) {
        return q.isMulti();
    });
    std::cout << term::DIM() << "  Quedan fuera " << excluded
              << " preguntas de respuesta múltiple (se preguntan íntegras en los otros modos).\n"
              << term::RESET();

    std::cout << "\n" << term::BOLD()
              << "¿Cuántas preguntas? (Enter = 30, 0 = todas, q = volver):" << term::RESET() << " ";
    std::cout.flush();
    std::string line;
    if (!term::readLine(line)) return;
    line = term::trim(line);
    if (term::upper(line) == "Q") return;
    size_t n = 30;
    if (!line.empty()) {
        try {
            long v = std::stol(line);
            if (v <= 0) n = pool.size();
            else n = static_cast<size_t>(v);
        } catch (...) { n = 30; }
    }
    if (n > pool.size()) n = pool.size();
    std::shuffle(pool.begin(), pool.end(), rng());
    pool.resize(n);
    runSession(pool, store, true, "ASORC");
}

static Lang langFromCode(const std::string& c) {
    if (c == "en") return Lang::EN;
    if (c == "bi") return Lang::BI;
    return Lang::ES;
}
static const char* langCode(Lang l) {
    switch (l) {
        case Lang::EN: return "en";
        case Lang::BI: return "bi";
        case Lang::ES: return "es";
    }
    return "es";
}

static void modeLanguage(Store& store) {
    term::header("Idioma");
    std::cout << "  Idioma actual: " << term::BOLD() << langName(g_lang)
              << term::RESET() << "\n\n";
    std::cout << "  " << term::BOLD() << "1" << term::RESET()
              << ". Español " << term::DIM() << "(por defecto)" << term::RESET() << "\n";
    std::cout << "  " << term::BOLD() << "2" << term::RESET()
              << ". Original en inglés\n";
    std::cout << "  " << term::BOLD() << "3" << term::RESET()
              << ". Bilingüe " << term::DIM() << "(español y debajo el original)"
              << term::RESET() << "\n";
    std::cout << term::DIM()
              << "\n  Durante una pregunta puedes pulsar 't' para alternar español "
                 "\u2194 original inglés.\n"
              << "  El libro ENI es originalmente español y no tiene versión inglesa.\n"
              << term::RESET();
    bool eof = false;
    int c = readMenuChoice("Opción (q=volver):", 1, 3, eof);
    if (c < 0) return;
    g_lang = c == 1 ? Lang::ES : (c == 2 ? Lang::EN : Lang::BI);
    store.setLang(langCode(g_lang));
    std::cout << "  Idioma establecido: " << term::BOLD() << langName(g_lang)
              << term::RESET() << "\n";
    term::pause();
}

static void showStats(const std::vector<Question>& all, const Store& store) {
    term::header("Mi progreso");
    long seen = 0, correct = 0, wrong = 0, blank = 0, partial = 0;
    for (const auto& q : all) {
        auto it = store.all().find(q.id);
        if (it == store.all().end()) continue;
        if (it->second.seen > 0) seen++;
        correct += it->second.correct;
        wrong   += it->second.wrong;
        blank   += it->second.blank;
        partial += it->second.partial;
    }
    std::cout << "  Preguntas del banco        : " << all.size() << "\n";
    std::cout << "  Vistas al menos una vez    : " << seen
              << term::DIM() << "  (" << (all.size() ? 100 * seen / static_cast<long>(all.size()) : 0)
              << "%)" << term::RESET() << "\n";
    std::cout << "  Sin ver todavía            : " << (static_cast<long>(all.size()) - seen) << "\n";
    term::rule('-');
    std::cout << "  Respuestas " << term::GREEN() << "correctas" << term::RESET() << "       : " << correct << "\n";
    std::cout << "  Respuestas " << term::RED()   << "incorrectas" << term::RESET() << "     : " << wrong << "\n";
    std::cout << "  Respuestas " << term::YEL()   << "parciales" << term::RESET() << "       : " << partial << "\n";
    std::cout << "  Respuestas " << term::YEL()   << "en blanco" << term::RESET() << "       : " << blank << "\n";

    // Temas con más fallos acumulados
    SessionStats st;
    for (const auto& q : all) {
        auto it = store.all().find(q.id);
        if (it == store.all().end()) continue;
        auto& t = st.byTopic[q.topic];
        t.first  += it->second.wrong + it->second.partial;
        t.second += it->second.seen;
    }
    printTopicBreakdown(st, "Temas donde más fallo (histórico):");
    term::pause();
}

static void printBanner(const std::vector<Question>& all) {
    long mc = std::count_if(all.begin(), all.end(), [](const Question& q) { return q.isSingle(); });
    long mr = std::count_if(all.begin(), all.end(), [](const Question& q) { return q.isMulti(); });
    long op = std::count_if(all.begin(), all.end(), [](const Question& q) { return q.isOpen(); });
    long as = std::count_if(all.begin(), all.end(), [](const Question& q) { return q.asorc.eligible; });
    std::cout << "\n" << term::BOLD() << term::CYAN()
              << "╔══════════════════════════════════════════════════════════════╗\n"
              << "║   test-ASORC · Banco de preguntas LPIC-2 (201 / 202)         ║\n"
              << "╚══════════════════════════════════════════════════════════════╝"
              << term::RESET() << "\n";
    long tr = std::count_if(all.begin(), all.end(),
                            [](const Question& q) { return q.translated; });
    std::cout << term::DIM() << "  " << all.size() << " preguntas · " << mc
              << " tipo test · " << mr << " respuesta múltiple · " << op
              << " abiertas · " << as << " en formato ASORC" << term::RESET() << "\n";
    std::cout << term::DIM() << "  idioma: " << term::RESET() << term::BOLD()
              << langName(g_lang) << term::RESET() << term::DIM()
              << "   ·   " << tr << " preguntas con traducción al español"
              << term::RESET() << "\n";
}

int main(int argc, char** argv) {
    std::string qpath = "questions.json";
    std::string ppath = "progress.json";
    std::string cliLang;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--no-color") term::g_color = false;
        else if (a == "--questions" && i + 1 < argc) qpath = argv[++i];
        else if (a == "--progress" && i + 1 < argc) ppath = argv[++i];
        else if (a == "--lang" && i + 1 < argc) {
            std::string l = argv[++i];
            if (l != "es" && l != "en" && l != "bi") {
                std::cerr << "--lang debe ser es, en o bi\n";
                return 2;
            }
            cliLang = l;
        }
        else if (a == "-h" || a == "--help") {
            std::cout << "Uso: " << argv[0]
                      << " [--questions questions.json] [--progress progress.json]"
                         " [--lang es|en|bi] [--no-color]\n"
                      << "  --lang  idioma de presentación: es (por defecto), en "
                         "(original inglés) o bi (bilingüe)\n";
            return 0;
        } else {
            std::cerr << "Argumento desconocido: " << a << "\n";
            return 2;
        }
    }
#if ASORC_POSIX
    if (!isatty(STDOUT_FILENO)) term::g_color = false;
#endif

    std::vector<Question> all;
    json::Value root;
    try {
        all = loadQuestions(qpath, root);
    } catch (const std::exception& e) {
        std::cerr << term::RED() << "Error cargando " << qpath << ": " << e.what()
                  << term::RESET() << "\n";
        return 1;
    }
    if (all.empty()) {
        std::cerr << "El banco de preguntas está vacío.\n";
        return 1;
    }

    Store store(ppath);
    g_lang = langFromCode(cliLang.empty() ? store.lang() : cliLang);
    if (!cliLang.empty()) store.setLang(cliLang);

    while (true) {
        printBanner(all);
        std::cout << "\n";
        std::cout << "  " << term::BOLD() << "1" << term::RESET() << ". Todas las preguntas (aleatorio)\n";
        std::cout << "  " << term::BOLD() << "2" << term::RESET() << ". Solo preguntas tipo test\n";
        std::cout << "  " << term::BOLD() << "3" << term::RESET() << ". Solo preguntas abiertas\n";
        std::cout << "  " << term::BOLD() << "4" << term::RESET() << ". Por libro\n";
        std::cout << "  " << term::BOLD() << "5" << term::RESET() << ". Por capítulo / tema\n";
        std::cout << "  " << term::BOLD() << "6" << term::RESET() << ". Solo preguntas falladas anteriormente\n";
        std::cout << "  " << term::BOLD() << "7" << term::RESET() << ". Repaso de preguntas que todavía no he visto\n";
        std::cout << "  " << term::BOLD() << "8" << term::RESET() << ". "
                  << term::MAG() << "Simulacro ASORC" << term::RESET() << "\n";
        std::cout << "  " << term::BOLD() << "9" << term::RESET() << ". Ver mi progreso\n";
        std::cout << "  " << term::BOLD() << "10" << term::RESET() << ". Idioma "
                  << term::DIM() << "(" << langName(g_lang) << ")" << term::RESET() << "\n";
        std::cout << "  " << term::BOLD() << "0" << term::RESET() << ". Salir\n";

        bool eof = false;
        int c = readMenuChoice("Elige una opción:", 0, 10, eof);
        if (eof || c < 0 || c == 0) break;

        switch (c) {
            case 1:
                runSession(ptrs(all), store, false, "todas");
                break;
            case 2:
                runSession(filter(all, [](const Question& q) { return !q.isOpen(); }), store,
                           false, "tipo test");
                break;
            case 3:
                runSession(filter(all, [](const Question& q) { return q.isOpen(); }), store,
                           false, "abiertas");
                break;
            case 4: modeByBook(all, store); break;
            case 5: modeByChapterOrTopic(all, store); break;
            case 6:
                runSession(filter(all, [&](const Question& q) { return store.failedBefore(q.id); }),
                           store, false, "falladas");
                break;
            case 7:
                runSession(filter(all, [&](const Question& q) { return !store.seenBefore(q.id); }),
                           store, false, "sin ver");
                break;
            case 8: modeAsorc(all, store); break;
            case 9: showStats(all, store); break;
            case 10: modeLanguage(store); break;
            default: break;
        }
    }

    store.save();
    std::cout << "\n" << term::DIM() << "Progreso guardado en " << ppath
              << ". ¡Hasta la próxima!" << term::RESET() << "\n";
    return 0;
}
