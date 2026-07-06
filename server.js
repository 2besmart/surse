require("dotenv").config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const path = require("path");
const { GoogleGenAI } = require('@google/genai');
const app = express();

app.use(express.json());
const allowedOrigins = [
    "http://localhost:3000" ,
    "http://127.0.0.1:5500" ,
    "https://2besmart.netlify.app"                 
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error("Blocat de CORS: Această origine nu are acces."));
        }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));
const mongoose = require("mongoose");


mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conectat cu succes la MongoDB Atlas!"))
    .catch(err => console.error("Eroare de conexiune la MongoDB:", err));

const ReviewSchema = new mongoose.Schema({
    name: { type: String, required: true },
    text: { type: String, required: true },
    rating: { type: Number, default: 5 },
    date: { type: String, default: () => new Date().toLocaleDateString("ro-RO") }
});

const Review = mongoose.model("Review", ReviewSchema);

app.post("/run", async (req, res) => {
    try {
        const fetch = global.fetch;
        const { script, input } = req.body;

        const response = await fetch("https://api.jdoodle.com/v1/execute", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.CLIENT_SECRET,
                script,
                stdin: input,
                language: "cpp17",
                versionIndex: "0"
            })
        });

        const data = await response.json();
        res.json(data);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "2besmart.contact@gmail.com",
        pass: process.env.EMAIL_PASS
    }
});

app.post("/send-email", async (req, res) => {
    const { name, fromEmail, subject, message } = req.body;

    const mailOptions = {
        from: `"${name}" <${fromEmail}>`,
        to: "2besmart.contact@gmail.com",
        subject: subject,
        text: `Nume expeditor: ${name}\nEmail expeditor: ${fromEmail}\n\nMesaj:\n${message}`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.json({ success: false });
    }
});

//Generator Quiz cu AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const systemPrompt = `Ești un generator de quiz-uri. Îți voi da un text.  Sarcina ta este să citești cu atenție textul și să generezi exact 10 propoziții distincte pe baza lui.
Urmează cu strictețe aceste reguli:
1. Conținut: Fiecare propoziție trebuie să includă cât mai multe date, cifre, nume sau detalii din textul inițial.
2. Amestec de adevăr/fals: Unele propoziții trebuie să fie complet ADEVĂRATE (să respecte fidel realitatea din text), iar altele FALSE (să modifice intenționat date, corelații sau fapte din text, dar păstrând cuvintele cheie). Ambele variante trebuie să aibă structuri sintactice și elemente de conectare diferite față de textul inițial.
3. RESTRICȚIE DE LIMBAJ (FOARTE IMPORTANT): Atât în textul propozițiilor, cât și în cadrul explicațiilor, ESTE STRICT INTERZISĂ utilizarea unor expresii metatextuale precum: „în text”, „în fraza analizată”, „conform textului”, „conținutul indică”, „textul afirmă”, „potrivit informațiilor oferite”, „este prezentat ca fiind” sau orice altă formulare similară. Răspunde direct și faptic, ca și cum faptele din text ar fi realități absolute.
4. Fiecare afirmație trebuie să urmărească mai multe caractere. 
5. Amestecă afirmațiile aleatoriu , sa nu am ai mult de 2 afirmații de același fel unua după cealaltă.
6. Nu adauga informatii adivarate in plus in propozitii.
Fiecare afirmație trebuie să aibă: id, textul afirmației, valoarea corectă (true/false), o explicație scurtă bazată pe text
Formatul trebuie să fie STRICT o listă validă de obiecte JSON (fără caractere Markdown precum \`\`\`json la început):
[
  {"id": 1, "text": "...", "correct": true, "explicatie": "..."},
  {"id": 2, "text": "...", "correct": false, "explicatie": "..."}
]`;

app.post('/generate-quiz', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: "Textul lipsește." });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Instrucțiuni: ${systemPrompt}\n\nText sursă: ${text}`,
            config: {
                responseMimeType: "application/json"
            }
        });

        const aiResponseString = response.text;
        const quizData = JSON.parse(aiResponseString);
        const finalQuestions = Array.isArray(quizData) ? quizData : (quizData.questions || Object.values(quizData)[0]);

        res.json(finalQuestions);

    } catch (error) {
        console.error("Eroare la Gemini:", error);
        res.status(500).json({ error: "A apărut o eroare la generarea quiz-ului." });
    }
});

const fs = require("fs");
const REVIEWS_FILE = path.join(__dirname, "reviews.json");

//Citește review-urile din fișier
const readReviews = () => {
    try {
        if (!fs.existsSync(REVIEWS_FILE)) {
            fs.writeFileSync(REVIEWS_FILE, JSON.stringify([]));
            return [];
        }
        const data = fs.readFileSync(REVIEWS_FILE, "utf-8");
        return JSON.parse(data || "[]");
    } catch (error) {
        console.error("Eroare la citirea review-urilor:", error);
        return [];
    }
};

const saveReviews = (reviews) => {
    try {
        fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
    } catch (error) {
        console.error("Eroare la salvarea review-urilor:", error);
    }
};

//Ia toate review-urile din baza de date
app.get("/reviews", async (req, res) => {
    try {
        const reviews = await Review.find().sort({ _id: -1 });
        res.json(reviews);
    } catch (error) {
        console.error("Eroare la aducerea review-urilor:", error);
        res.status(500).json({ error: "Eroare de server" });
    }
});

// Salvează un review nou în baza de date permanentă
app.post("/reviews", async (req, res) => {
    try {
        const { name, text, rating } = req.body;

        if (!name || !text) {
            return res.status(400).json({ error: "Numele și mesajul sunt obligatorii." });
        }

        const newReview = new Review({
            name,
            text,
            rating: Number(rating) || 5
        });

        await newReview.save();

        res.json({ success: true, review: newReview });
    } catch (error) {
        console.error("Eroare la salvarea review-ului:", error);
        res.status(500).json({ error: "Nu s-a putut salva review-ul." });
    }
});


const CounterSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', CounterSchema);

// incrementarea click-urilor în funcție de ID
app.post('/api/increment-clicks/:buttonId', async (req, res) => {
    const { buttonId } = req.params;
    try {
        const counter = await Counter.findOneAndUpdate(
            { id: `click_${buttonId}` },
            { $inc: { value: 1 } },
            { new: true, upsert: true }
        );
        res.json({ success: true, value: counter.value });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/get-all-counters', async (req, res) => {
    try {
        const counters = await Counter.find();
        const dataObj = {};
        counters.forEach(c => {
            dataObj[c.id] = c.value;
        });
        res.json(dataObj);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});