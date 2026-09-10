#include "Patch.h"
#include <cmath>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>
#include <stdexcept>
namespace mct::origami {
namespace {
void require(bool value, const char* message) { if (!value) throw std::invalid_argument(message); }
bool utf8(std::string_view text) {
    for (std::size_t i=0; i<text.size();) {
        const auto c=static_cast<unsigned char>(text[i++]);
        if (c<128) continue;
        unsigned n=0, code=0, minimum=0;
        if (c>=0xc2 && c<=0xdf) {n=1;code=c&31;minimum=128;}
        else if (c>=0xe0 && c<=0xef) {n=2;code=c&15;minimum=2048;}
        else if (c>=0xf0 && c<=0xf4) {n=3;code=c&7;minimum=65536;}
        else return false;
        if (i+n>text.size()) return false;
        while(n--) {const auto b=static_cast<unsigned char>(text[i++]); if ((b&0xc0)!=0x80) return false; code=(code<<6)|(b&63);}
        if (code<minimum || code>0x10ffff || (code>=0xd800 && code<=0xdfff)) return false;
    }
    return true;
}
void appendUtf8(std::string& result, unsigned code) {
    if(code<128) result+=static_cast<char>(code);
    else if(code<2048) {result+=static_cast<char>(0xc0|(code>>6));result+=static_cast<char>(0x80|(code&63));}
    else if(code<65536) {result+=static_cast<char>(0xe0|(code>>12));result+=static_cast<char>(0x80|((code>>6)&63));result+=static_cast<char>(0x80|(code&63));}
    else {result+=static_cast<char>(0xf0|(code>>18));result+=static_cast<char>(0x80|((code>>12)&63));result+=static_cast<char>(0x80|((code>>6)&63));result+=static_cast<char>(0x80|(code&63));}
}
class Reader {
public:
    explicit Reader(std::string_view text): text_(text) {}
    void space() { while(pos_<text_.size() && (text_[pos_]==' ' || text_[pos_]=='\t' || text_[pos_]=='\r' || text_[pos_]=='\n')) ++pos_; }
    bool take(char c) {space(); if(pos_<text_.size() && text_[pos_]==c) {++pos_;return true;} return false;}
    void expect(char c) {require(take(c), "Unexpected JSON token");}
    bool end() {space();return pos_==text_.size();}
    std::string string() {
        expect('"');std::string result;
        while(pos_<text_.size()) {
            const auto c=static_cast<unsigned char>(text_[pos_++]);
            if(c=='"') {require(utf8(result),"Invalid UTF-8 string");return result;}
            require(c>=32,"Unescaped control character");
            if(c!='\\') {result+=static_cast<char>(c);continue;}
            require(pos_<text_.size(),"Incomplete escape");
            const char escaped=text_[pos_++];
            switch(escaped) {
                case '"':case '\\':case '/':result+=escaped;break;
                case 'b':result+='\b';break;case 'f':result+='\f';break;
                case 'n':result+='\n';break;case 'r':result+='\r';break;case 't':result+='\t';break;
                case 'u': {
                    unsigned code=hex();
                    if(code>=0xd800 && code<=0xdbff) {
                        require(pos_+2<=text_.size() && text_[pos_]=='\\' && text_[pos_+1]=='u',"Missing low surrogate");pos_+=2;
                        const unsigned low=hex();require(low>=0xdc00 && low<=0xdfff,"Invalid low surrogate");
                        code=0x10000+((code-0xd800)<<10)+(low-0xdc00);
                    } else require(code<0xdc00 || code>0xdfff,"Unpaired surrogate");
                    appendUtf8(result,code);break;
                }
                default:throw std::invalid_argument("Invalid string escape");
            }
        }
        throw std::invalid_argument("Unterminated string");
    }
    double number() {
        space();const auto start=pos_;
        if(pos_<text_.size() && text_[pos_]=='-') ++pos_;
        require(pos_<text_.size(),"Missing number");
        if(text_[pos_]=='0') ++pos_;
        else {require(text_[pos_]>='1' && text_[pos_]<='9',"Invalid number");digits();}
        if(pos_<text_.size() && text_[pos_]=='.') {++pos_;const auto begin=pos_;digits();require(pos_>begin,"Missing fraction");}
        if(pos_<text_.size() && (text_[pos_]=='e'||text_[pos_]=='E')) {++pos_;if(pos_<text_.size() && (text_[pos_]=='+'||text_[pos_]=='-')) ++pos_;const auto begin=pos_;digits();require(pos_>begin,"Missing exponent");}
        std::istringstream stream(std::string{text_.substr(start,pos_-start)});stream.imbue(std::locale::classic());
        double value=0;stream>>value;require(!stream.fail() && std::isfinite(value),"Invalid finite number");return value;
    }
private:
    void digits() {while(pos_<text_.size() && text_[pos_]>='0' && text_[pos_]<='9') ++pos_;}
    unsigned hex() {
        require(pos_+4<=text_.size(),"Incomplete Unicode escape");unsigned value=0;
        for(int i=0;i<4;++i) {const char c=text_[pos_++];int n=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;require(n>=0,"Invalid Unicode escape");value=(value<<4)|static_cast<unsigned>(n);}
        return value;
    }
    std::string_view text_;std::size_t pos_=0;
};
std::string quote(std::string_view text) {
    require(utf8(text),"Invalid UTF-8 string");std::string result="\"";constexpr char hex[]="0123456789abcdef";
    for(unsigned char c:text) {
        if(c=='"'||c=='\\') {result+='\\';result+=static_cast<char>(c);}
        else if(c<32) {result+="\\u00";result+=hex[c>>4];result+=hex[c&15];}
        else result+=static_cast<char>(c);
    }
    return result+'"';
}
void validate(const Patch& patch) {
    require(!patch.name.empty() && patch.name.size()<=256 && utf8(patch.name),"Invalid patch name (1–256 UTF-8 bytes)");
    for(const auto& p:parameterRegistry()) {
        const float v=patch.parameters[static_cast<std::size_t>(p.id)];
        require(std::isfinite(v) && v>=p.minimum && v<=p.maximum,"Parameter outside allowed range");
        require(p.scale!=ParameterScale::Choice || v==std::round(v),"Choice parameter must be an integer");
    }
}
}
bool parsePatch(std::string_view json, Patch& output, std::string& error) {
    try {
        require(json.size()<=65536,"Patch exceeds 64 KiB limit");Reader reader(json);Patch patch;
        unsigned seen=0;reader.expect('{');
        do {
            const auto key=reader.string();reader.expect(':');unsigned bit=0;
            if(key=="format") {bit=1;require(reader.string()=="mct-origami","Not an MCT Origami patch");}
            else if(key=="version") {bit=2;require(reader.number()==Patch::version,"Unsupported patch version");}
            else if(key=="name") {bit=4;patch.name=reader.string();}
            else if(key=="parameters") {
                bit=8;reader.expect('{');std::array<bool,parameterCount> parameters {};
                do {
                    const auto id=reader.string();const auto* p=findParameter(id);require(p!=nullptr,"Unknown parameter ID");
                    const auto index=static_cast<std::size_t>(p->id);require(!parameters[index],"Duplicate parameter ID");parameters[index]=true;
                    reader.expect(':');const auto value=reader.number();
                    require(value>=-std::numeric_limits<float>::max() && value<=std::numeric_limits<float>::max(),"Parameter magnitude too large");
                    require(static_cast<float>(value)>=p->minimum && static_cast<float>(value)<=p->maximum,"Parameter outside allowed range");
                    require(p->scale!=ParameterScale::Choice || value==std::round(value),"Choice parameter must be an integer");
                    patch.parameters[index]=static_cast<float>(value);
                } while(reader.take(','));
                reader.expect('}');
                // v1 shipped with 10, then 13, then 15 parameters. Only complete
                // historical sets may omit appended fields; defaults migrate them.
                std::size_t count=0;for(bool present:parameters) if(present) ++count;
                require(count==10 || count==13 || count==parameterCount,"Missing parameter ID");
                for(std::size_t i=0;i<parameters.size();++i)
                    require(parameters[i]==(i<count),"Missing parameter ID");
            } else throw std::invalid_argument("Unknown patch field");
            require(!(seen&bit),"Duplicate patch field");seen|=bit;
        } while(reader.take(','));
        reader.expect('}');require(reader.end(),"Trailing JSON content");require(seen==15,"Missing patch field");validate(patch);
        output=std::move(patch);error.clear();return true;
    } catch(const std::invalid_argument& exception) {error=exception.what();return false;}
}
std::string serializePatch(const Patch& patch) {
    validate(patch);std::ostringstream stream;stream.imbue(std::locale::classic());stream<<std::setprecision(std::numeric_limits<float>::max_digits10);
    stream<<"{\n  \"format\": \"mct-origami\",\n  \"version\": 1,\n  \"name\": "<<quote(patch.name)<<",\n  \"parameters\": {\n";
    for(std::size_t i=0;i<parameterCount;++i) {const auto& p=parameterRegistry()[i];stream<<"    "<<quote(p.key)<<": "<<patch.parameters[i]<<(i+1==parameterCount?"\n":",\n");}
    stream<<"  }\n}\n";return stream.str();
}

} // namespace mct::origami
