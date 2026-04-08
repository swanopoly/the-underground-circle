// schoolsData.ts — Curriculum data for The Underground Circle education section

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type AgeRange = '10-12' | '12-14' | '13-16' | '14-18' | '15-18' | '16-18' | 'all';
export type SectionType = 'learn' | 'explore' | 'challenge' | 'reflect' | 'connect';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonSection {
  type: SectionType;
  title: string;
  content: string;
  bulletPoints?: string[];
}

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  xpReward: number;
  durationMinutes: number;
  sections: LessonSection[];
  quiz: QuizQuestion[];
}

export interface Module {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  difficulty: Difficulty;
  ageRange: AgeRange;
  lessons: Lesson[];
  badgeId: string;
  badgeName: string;
}

export interface Track {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  modules: Module[];
}

export const TRACKS: Track[] = [
  // =====================================================================
  // TRACK 1: AI TECHNOLOGY
  // =====================================================================
  {
    id: 'ai-tech',
    title: 'AI Technology',
    subtitle: 'Understand and build with artificial intelligence',
    description: 'From understanding what AI is to building your own projects, this track takes you on a journey through the technology reshaping our world.',
    icon: 'AI',
    color: '#22c55e',
    modules: [
      // MODULE 1: What Is AI?
      {
        id: 'what-is-ai',
        title: 'What Is AI?',
        subtitle: 'Smart machines vs thinking humans',
        description: 'Discover what artificial intelligence really is, how it differs from human thinking, and where you already encounter it every day.',
        icon: 'brain',
        color: '#22c55e',
        difficulty: 'beginner',
        ageRange: '10-12',
        badgeId: 'badge-what-is-ai',
        badgeName: 'AI Explorer',
        lessons: [
          {
            id: 'ai-daily-life',
            title: 'AI in Your Daily Life',
            subtitle: 'You already use AI more than you think',
            xpReward: 50,
            durationMinutes: 10,
            sections: [
              {
                type: 'learn',
                title: 'AI Is Everywhere',
                content: 'Artificial intelligence is already woven into your daily routine. When your phone suggests the next word you want to type, when a streaming service recommends a show, or when a voice assistant answers your question — that is AI at work. These systems analyze patterns in huge amounts of data to make predictions and decisions.',
                bulletPoints: [
                  'Autocomplete and spell-check use AI to predict what you want to type',
                  'Recommendation algorithms on YouTube, Netflix, and Spotify learn your preferences',
                  'Voice assistants like Siri and Alexa convert speech to text using AI models',
                  'Navigation apps use AI to predict traffic and find the fastest route',
                ],
              },
              {
                type: 'explore',
                title: 'Spot the AI',
                content: 'Think about the last hour of your day. How many times did you interact with an AI system without realizing it? Social media feeds are curated by AI, photo apps automatically enhance your pictures, and even the ads you see are chosen by algorithms. The key insight is that most modern AI is designed to be invisible — it works behind the scenes.',
                bulletPoints: [
                  'Social media feeds are ranked by AI, not shown in chronological order',
                  'Email spam filters use AI to protect your inbox',
                  'Face unlock on phones uses AI-powered facial recognition',
                ],
              },
              {
                type: 'challenge',
                title: 'AI Detective Activity',
                content: 'For the next 24 hours, keep a log of every time you think AI is involved in something you do. Write down what happened, what you think the AI was doing, and whether it helped or annoyed you. You might be surprised how long your list gets by the end of the day.',
              },
              {
                type: 'reflect',
                title: 'Thinking It Through',
                content: 'Now that you know AI is everywhere, consider: does it bother you that so many decisions are being made by algorithms? Are there places where you would prefer a human to be in charge instead of AI? There are no wrong answers here — the goal is to start thinking critically about the technology you use.',
              },
            ],
            quiz: [
              {
                id: 'q-adl-1',
                question: 'Which of the following is an example of AI in everyday life?',
                options: [
                  'A calculator doing basic math',
                  'A streaming service recommending shows based on your watch history',
                  'A light switch turning on a lamp',
                  'A printed book sitting on a shelf',
                ],
                correctIndex: 1,
                explanation: 'Recommendation systems use AI to analyze your viewing patterns and suggest content you might enjoy. A calculator follows fixed rules without learning, so it is not AI.',
              },
              {
                id: 'q-adl-2',
                question: 'Why is most AI in consumer products designed to be "invisible"?',
                options: [
                  'Because companies want to hide that they use AI',
                  'Because AI works best when users interact with it naturally without thinking about it',
                  'Because AI is too ugly to show on screen',
                  'Because AI is illegal to display openly',
                ],
                correctIndex: 1,
                explanation: 'AI in consumer products is designed to blend seamlessly into the user experience. The goal is to help you naturally, like predicting your next word or filtering spam, without requiring you to understand the technology behind it.',
              },
              {
                id: 'q-adl-3',
                question: 'What do recommendation algorithms primarily rely on to suggest content?',
                options: [
                  'Random guessing',
                  'Patterns in user behavior and preferences',
                  'The personal opinions of programmers',
                  'The alphabetical order of content titles',
                ],
                correctIndex: 1,
                explanation: 'Recommendation algorithms analyze patterns in how you and millions of other users interact with content — what you watch, skip, like, and replay — to predict what you will enjoy next.',
              },
            ],
          },
          {
            id: 'rules-vs-learning',
            title: 'Rules vs Learning',
            subtitle: 'Two very different ways computers can be smart',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Traditional Programming',
                content: 'In traditional programming, a human writes explicit rules that the computer follows step by step. For example, a spam filter might say: "If the email contains the word FREE in all caps and has more than three exclamation marks, mark it as spam." The computer never deviates from these rules and cannot handle situations the programmer did not anticipate.',
                bulletPoints: [
                  'Rules are written by human programmers',
                  'The computer follows instructions exactly',
                  'Works well for problems with clear, defined rules',
                  'Cannot adapt to new situations on its own',
                ],
              },
              {
                type: 'learn',
                title: 'Machine Learning Approach',
                content: 'Machine learning flips the script. Instead of writing rules, you give the computer thousands of examples and let it figure out the patterns on its own. Show it 10,000 spam emails and 10,000 legitimate emails, and it will learn to distinguish between them — often catching patterns that humans would never think to write rules for.',
                bulletPoints: [
                  'The computer learns patterns from examples (data)',
                  'It can discover rules humans might miss',
                  'Gets better with more data',
                  'Can adapt to new types of problems',
                ],
              },
              {
                type: 'explore',
                title: 'When Rules Beat Learning',
                content: 'Machine learning is not always the best choice. For tasks with clear, unchanging rules — like calculating tax or converting temperatures — traditional programming is simpler, more reliable, and easier to understand. Machine learning shines when the rules are too complex to write by hand, like recognizing a face or understanding spoken language.',
              },
              {
                type: 'reflect',
                title: 'The Key Difference',
                content: 'Think of it this way: traditional programming is like giving someone a recipe to follow. Machine learning is like showing someone a hundred cakes and asking them to figure out how to bake one. Both approaches produce results, but they work in fundamentally different ways. Understanding this distinction is the foundation for everything else in AI.',
              },
            ],
            quiz: [
              {
                id: 'q-rvl-1',
                question: 'What is the main difference between traditional programming and machine learning?',
                options: [
                  'Traditional programming is faster than machine learning',
                  'In traditional programming, humans write the rules; in ML, the computer learns rules from data',
                  'Machine learning does not use computers',
                  'Traditional programming cannot run on modern hardware',
                ],
                correctIndex: 1,
                explanation: 'The fundamental difference is who creates the rules. In traditional programming, humans explicitly write every rule. In machine learning, the computer discovers patterns and rules by analyzing large amounts of data.',
              },
              {
                id: 'q-rvl-2',
                question: 'Which task would be BEST suited for machine learning rather than traditional programming?',
                options: [
                  'Converting miles to kilometers',
                  'Recognizing cats in photos',
                  'Calculating the area of a rectangle',
                  'Sorting a list alphabetically',
                ],
                correctIndex: 1,
                explanation: 'Recognizing cats in photos requires understanding complex visual patterns that are nearly impossible to describe with explicit rules. Traditional programming works better for well-defined mathematical tasks like conversions and calculations.',
              },
              {
                id: 'q-rvl-3',
                question: 'Why might traditional programming be preferred over ML for calculating sales tax?',
                options: [
                  'Because ML cannot work with numbers',
                  'Because tax rules are clear and fixed, making explicit rules simpler and more reliable',
                  'Because ML is too expensive for math',
                  'Because governments ban ML for tax calculations',
                ],
                correctIndex: 1,
                explanation: 'Tax calculations follow clear, well-defined rules set by law. Traditional programming handles these perfectly with simple, verifiable code. Using ML would add unnecessary complexity and potential for errors in a task that does not require pattern recognition.',
              },
            ],
          },
          {
            id: 'history-of-ai',
            title: 'Brief History of AI',
            subtitle: 'From dreams of thinking machines to ChatGPT',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'The Birth of AI (1950s)',
                content: 'The idea of artificial intelligence was formally born in 1956 at a workshop at Dartmouth College, where researchers proposed that every aspect of learning could be described precisely enough for a machine to simulate it. Alan Turing had already asked "Can machines think?" in 1950 and proposed the Turing Test — a way to measure whether a machine could behave indistinguishably from a human.',
                bulletPoints: [
                  'Alan Turing proposed the Turing Test in 1950',
                  'The term "Artificial Intelligence" was coined at Dartmouth in 1956',
                  'Early AI focused on logic, games, and problem-solving',
                  'Researchers were very optimistic — they thought human-level AI was 20 years away',
                ],
              },
              {
                type: 'learn',
                title: 'AI Winters and Breakthroughs',
                content: 'AI has gone through cycles of hype and disappointment called "AI winters." In the 1970s and 1980s, funding dried up when early promises were not met. But breakthroughs kept coming: expert systems in the 1980s, IBM Deep Blue beating the world chess champion in 1997, and Watson winning Jeopardy in 2011. Each wave taught researchers what worked and what did not.',
              },
              {
                type: 'learn',
                title: 'The Deep Learning Revolution',
                content: 'The current AI boom started around 2012 when deep learning — neural networks with many layers — began crushing records in image recognition and language tasks. Three factors came together: much more data from the internet, powerful GPUs for fast computation, and improved algorithms. By 2022, large language models like ChatGPT showed the world that AI could hold conversations, write code, and create content.',
                bulletPoints: [
                  '2012: Deep learning wins ImageNet competition by a huge margin',
                  '2016: AlphaGo beats world champion at Go, a game thought too complex for AI',
                  '2020-2023: Large language models (GPT, Claude) transform how people interact with AI',
                  'AI can now generate text, images, music, and video',
                ],
              },
              {
                type: 'reflect',
                title: 'What Comes Next?',
                content: 'AI has progressed enormously, but it still cannot truly understand the world the way humans do. Current AI is powerful but narrow — it excels at specific tasks but lacks common sense, emotions, and genuine understanding. As you learn more about AI, you will be part of the generation that decides where this technology goes next.',
              },
            ],
            quiz: [
              {
                id: 'q-hai-1',
                question: 'When was the term "Artificial Intelligence" first coined?',
                options: [
                  '1943',
                  '1956',
                  '1997',
                  '2012',
                ],
                correctIndex: 1,
                explanation: 'The term "Artificial Intelligence" was first used at the Dartmouth Workshop in 1956, where a group of researchers gathered to discuss the possibility of creating thinking machines.',
              },
              {
                id: 'q-hai-2',
                question: 'What three factors drove the deep learning revolution starting around 2012?',
                options: [
                  'Faster internet, social media, and smartphones',
                  'More data, powerful GPUs, and improved algorithms',
                  'Government funding, quantum computers, and robots',
                  'Virtual reality, blockchain, and 5G networks',
                ],
                correctIndex: 1,
                explanation: 'The deep learning revolution was powered by the combination of massive datasets from the internet, powerful GPU hardware that could train large neural networks quickly, and advances in algorithms and architectures.',
              },
              {
                id: 'q-hai-3',
                question: 'What is an "AI winter"?',
                options: [
                  'A season when AI works poorly due to cold weather',
                  'A period when interest and funding in AI declined due to unmet expectations',
                  'A type of AI algorithm inspired by winter storms',
                  'A yearly conference about AI held in December',
                ],
                correctIndex: 1,
                explanation: 'AI winters were periods when hype about AI exceeded what the technology could actually deliver, leading to disappointment, reduced funding, and slower progress. There were notable AI winters in the 1970s and late 1980s.',
              },
            ],
          },
        ],
      },
      // MODULE 2: How Machines Learn
      {
        id: 'how-machines-learn',
        title: 'How Machines Learn',
        subtitle: 'Teaching computers to see patterns',
        description: 'Explore the core concepts behind machine learning — how computers learn from data, what training looks like, and what happens when things go wrong.',
        icon: 'chart',
        color: '#22c55e',
        difficulty: 'beginner',
        ageRange: '12-14',
        badgeId: 'badge-how-machines-learn',
        badgeName: 'Pattern Spotter',
        lessons: [
          {
            id: 'supervised-learning',
            title: 'Supervised Learning',
            subtitle: 'Learning from labeled examples',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'What Is Supervised Learning?',
                content: 'Supervised learning is the most common type of machine learning. You give the computer a dataset where each example has a label — the correct answer. For instance, thousands of photos labeled "cat" or "dog." The model studies these labeled examples and learns to predict the correct label for new, unseen data.',
                bulletPoints: [
                  'Each training example comes with a correct answer (label)',
                  'The model learns to map inputs to outputs',
                  'Classification: predicting a category (spam or not spam)',
                  'Regression: predicting a number (tomorrow\'s temperature)',
                ],
              },
              {
                type: 'explore',
                title: 'Real-World Examples',
                content: 'Supervised learning powers many tools you use daily. Email spam filters learned from millions of emails labeled as spam or not-spam. Medical AI systems learn from X-rays labeled by doctors. Self-driving car systems learn from millions of labeled driving scenarios. In every case, human-provided labels are the teacher.',
              },
              {
                type: 'challenge',
                title: 'Be the Training Data',
                content: 'Imagine you are building an AI to identify whether a restaurant review is positive or negative. Write down ten short reviews and label each as "positive" or "negative." Now think: what about a review like "The food was amazing but the service was terrible"? This mixed example shows why labeling data is harder than it seems.',
              },
              {
                type: 'reflect',
                title: 'Limitations of Labels',
                content: 'Supervised learning is only as good as its labels. If the humans who labeled the data made mistakes or had biases, the model will learn those mistakes and biases. This is why data quality matters as much as data quantity in machine learning.',
              },
            ],
            quiz: [
              {
                id: 'q-sl-1',
                question: 'What makes supervised learning "supervised"?',
                options: [
                  'A human watches the computer at all times',
                  'The training data includes correct answers (labels) that guide the learning',
                  'The computer supervises other computers',
                  'It requires a supervisor password to run',
                ],
                correctIndex: 1,
                explanation: 'In supervised learning, the "supervision" comes from labeled data — each training example includes the correct answer, which the model uses to learn the relationship between inputs and outputs.',
              },
              {
                id: 'q-sl-2',
                question: 'Which is an example of a classification task?',
                options: [
                  'Predicting tomorrow\'s exact temperature',
                  'Estimating a house\'s price',
                  'Sorting emails into spam and not-spam',
                  'Counting the number of words in a sentence',
                ],
                correctIndex: 2,
                explanation: 'Classification means predicting which category something belongs to. Sorting emails into "spam" or "not-spam" is a classic binary classification task. Predicting temperature or house prices are regression tasks because they predict a continuous number.',
              },
              {
                id: 'q-sl-3',
                question: 'Why is data quality important in supervised learning?',
                options: [
                  'Because computers prefer high-quality screens',
                  'Because the model learns from the labels, so incorrect labels lead to incorrect learning',
                  'Because low-quality data takes up less storage space',
                  'Because data quality only matters for unsupervised learning',
                ],
                correctIndex: 1,
                explanation: 'A supervised learning model treats its training labels as ground truth. If those labels contain errors or biases, the model will learn and reproduce those same errors and biases in its predictions.',
              },
            ],
          },
          {
            id: 'training-data-models',
            title: 'Training Data & Models',
            subtitle: 'The ingredients of machine learning',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Data: The Fuel of AI',
                content: 'A machine learning model is only as good as the data it learns from. Training data is the collection of examples used to teach the model. More diverse, representative data generally produces better models. Think of data as the textbook and the model as the student — a bad textbook leads to a poorly educated student.',
                bulletPoints: [
                  'Training data: the examples the model learns from',
                  'Validation data: examples used to check progress during training',
                  'Test data: examples held back to evaluate the final model',
                  'More diverse data helps the model generalize to new situations',
                ],
              },
              {
                type: 'learn',
                title: 'What Is a Model?',
                content: 'A model is the mathematical structure that learns patterns from data. Before training, a model is like a blank brain. During training, it adjusts millions of internal parameters to better fit the training data. After training, it can make predictions on new data it has never seen before. Different model architectures are suited for different tasks — convolutional networks for images, transformers for language.',
              },
              {
                type: 'explore',
                title: 'The Training Process',
                content: 'Training a model is an iterative process. The model makes a prediction, checks how wrong it was (using a loss function), and then slightly adjusts its parameters to be less wrong next time. This cycle repeats millions of times. It is like a student practicing math problems — each mistake teaches them to do better on the next attempt.',
                bulletPoints: [
                  'Forward pass: the model makes a prediction',
                  'Loss calculation: measure how wrong the prediction was',
                  'Backward pass: figure out which parameters to adjust',
                  'Update: slightly adjust parameters to reduce error',
                  'Repeat millions of times until the model is accurate',
                ],
              },
              {
                type: 'reflect',
                title: 'Models Are Not Magic',
                content: 'It is tempting to think of AI models as magical black boxes, but they are mathematical machines that find patterns in numbers. Every image is converted to numbers, every word is converted to numbers, and the model does math on those numbers. Understanding this demystifies AI and helps you think critically about what it can and cannot do.',
              },
            ],
            quiz: [
              {
                id: 'q-tdm-1',
                question: 'What are the three types of data splits used in machine learning?',
                options: [
                  'Input data, output data, and error data',
                  'Training data, validation data, and test data',
                  'Big data, small data, and medium data',
                  'Public data, private data, and secret data',
                ],
                correctIndex: 1,
                explanation: 'Machine learning uses three data splits: training data to teach the model, validation data to tune and check progress during training, and test data (held completely separate) to evaluate final performance on unseen examples.',
              },
              {
                id: 'q-tdm-2',
                question: 'What does a "loss function" measure during training?',
                options: [
                  'How much money the training costs',
                  'How much data was lost during processing',
                  'How wrong the model\'s predictions are compared to the correct answers',
                  'How many parameters the model has lost',
                ],
                correctIndex: 2,
                explanation: 'A loss function (also called a cost function) measures the difference between the model\'s predictions and the actual correct answers. The goal of training is to minimize this loss, making the model\'s predictions as accurate as possible.',
              },
              {
                id: 'q-tdm-3',
                question: 'Why is diverse training data important?',
                options: [
                  'It makes the dataset look more colorful',
                  'It helps the model generalize well to new, unseen situations',
                  'It is required by law in all countries',
                  'It makes training faster',
                ],
                correctIndex: 1,
                explanation: 'Diverse training data exposes the model to a wide range of examples, helping it learn robust patterns that apply to new situations. A model trained only on limited data may fail when it encounters examples different from what it has seen.',
              },
            ],
          },
          {
            id: 'when-models-go-wrong',
            title: 'When Models Go Wrong',
            subtitle: 'Overfitting, underfitting, and other pitfalls',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Overfitting: Memorizing Instead of Learning',
                content: 'Overfitting happens when a model memorizes the training data instead of learning general patterns. It performs brilliantly on training data but poorly on new data. Imagine a student who memorizes every answer in a textbook but cannot solve a slightly different problem on the exam. This is the most common pitfall in machine learning.',
                bulletPoints: [
                  'High accuracy on training data but poor accuracy on test data',
                  'The model has learned noise and specific details instead of patterns',
                  'More common with complex models and small datasets',
                  'Prevented by using more data, simpler models, or regularization techniques',
                ],
              },
              {
                type: 'learn',
                title: 'Underfitting: Not Learning Enough',
                content: 'Underfitting is the opposite problem — the model is too simple to capture the patterns in the data. It performs poorly on both training and test data. This is like trying to draw a curve with only a straight line — no matter how you adjust it, a line cannot capture a curved pattern.',
              },
              {
                type: 'explore',
                title: 'Famous AI Failures',
                content: 'Real-world AI failures remind us why careful development matters. Microsoft\'s chatbot Tay learned toxic language from Twitter users within hours. Amazon scrapped a hiring AI that discriminated against women because its training data reflected historical hiring biases. A healthcare algorithm was found to systematically underserve Black patients because it used healthcare spending (not health needs) as a proxy for illness.',
                bulletPoints: [
                  'Tay chatbot: learned harmful behavior from biased interactions',
                  'Amazon hiring tool: reflected gender bias in historical data',
                  'Healthcare algorithm: used a biased proxy that disadvantaged Black patients',
                  'Self-driving car errors: struggled with unusual road situations not in training data',
                ],
              },
              {
                type: 'reflect',
                title: 'Testing Matters',
                content: 'These failures show why rigorous testing and diverse perspectives are essential in AI development. Models should be tested across different populations, edge cases, and scenarios before deployment. When you build AI, always ask: who might this harm? What scenarios has it not been tested on?',
              },
            ],
            quiz: [
              {
                id: 'q-wmgw-1',
                question: 'What is overfitting?',
                options: [
                  'When a model is too large to fit in computer memory',
                  'When a model memorizes training data instead of learning general patterns',
                  'When you use too much training data',
                  'When a model makes perfect predictions on all data',
                ],
                correctIndex: 1,
                explanation: 'Overfitting occurs when a model learns the specific details and noise in the training data rather than the underlying patterns. It performs well on training data but poorly on new, unseen data because it has memorized rather than generalized.',
              },
              {
                id: 'q-wmgw-2',
                question: 'If a model performs poorly on BOTH training and test data, what is the likely problem?',
                options: [
                  'Overfitting',
                  'The test data is broken',
                  'Underfitting',
                  'The model is overfit to the test data',
                ],
                correctIndex: 2,
                explanation: 'Poor performance on both training and test data indicates underfitting — the model is too simple to capture the patterns in the data. Overfitting would show high training accuracy but low test accuracy.',
              },
              {
                id: 'q-wmgw-3',
                question: 'What caused Amazon\'s hiring AI to discriminate against women?',
                options: [
                  'A programming bug that rejected female names',
                  'The AI was trained on historical hiring data that reflected existing gender biases',
                  'Women applied less frequently so the AI had fewer examples',
                  'The AI was deliberately programmed with biased rules',
                ],
                correctIndex: 1,
                explanation: 'Amazon\'s AI was trained on historical hiring data that reflected a male-dominated tech industry. The model learned these patterns and penalized resumes that indicated the applicant was female, demonstrating how biased training data leads to biased models.',
              },
            ],
          },
        ],
      },
      // MODULE 3: Prompt Engineering
      {
        id: 'prompt-engineering',
        title: 'Prompt Engineering',
        subtitle: 'The art of talking to AI',
        description: 'Learn how to communicate effectively with AI systems to get better, more accurate, and more useful results every time.',
        icon: 'message',
        color: '#22c55e',
        difficulty: 'intermediate',
        ageRange: '13-16',
        badgeId: 'badge-prompt-engineering',
        badgeName: 'Prompt Crafter',
        lessons: [
          {
            id: 'why-prompts-matter',
            title: 'Why Prompts Matter',
            subtitle: 'Garbage in, garbage out',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'The Prompt Is Everything',
                content: 'A prompt is the instruction or question you give to an AI system. The quality of the AI\'s response depends heavily on the quality of your prompt. A vague prompt gets a vague answer. A specific, well-structured prompt gets a focused, useful response. Learning to write good prompts is one of the most valuable skills in the AI age.',
                bulletPoints: [
                  'Prompts are how humans communicate intent to AI',
                  'Small changes in wording can dramatically change AI output',
                  'Good prompts include context, constraints, and clear goals',
                  'Prompt engineering is a real job at major tech companies',
                ],
              },
              {
                type: 'explore',
                title: 'Good vs Bad Prompts',
                content: 'Compare these two prompts: "Tell me about space" versus "Explain three key differences between rocky planets and gas giants in our solar system, using examples a middle schooler would understand." The first prompt could generate anything. The second prompt tells the AI exactly what you want, how much detail to include, and what audience level to target.',
              },
              {
                type: 'challenge',
                title: 'Prompt Makeover',
                content: 'Take this weak prompt and rewrite it three different ways, each better than the last: "Write something about dogs." Think about what information you can add — the type of writing, the audience, the specific topic, the length, and the tone. Notice how each version gives the AI clearer direction.',
              },
              {
                type: 'reflect',
                title: 'Why This Skill Transfers',
                content: 'Prompt engineering is really about clear communication. The skills you develop — being specific, providing context, defining your audience, and stating your goals — make you a better communicator in all areas of life. Whether you are writing an email, giving instructions, or asking a question in class, clarity always produces better results.',
              },
            ],
            quiz: [
              {
                id: 'q-wpm-1',
                question: 'What is a "prompt" in the context of AI?',
                options: [
                  'The time it takes for AI to respond',
                  'The instruction or question given to an AI system',
                  'The programming language AI is written in',
                  'A type of AI hardware',
                ],
                correctIndex: 1,
                explanation: 'A prompt is the input text you provide to an AI system — your instruction, question, or request. It is the primary way humans communicate what they want the AI to do.',
              },
              {
                id: 'q-wpm-2',
                question: 'Which is a better prompt for an AI assistant?',
                options: [
                  '"Tell me about history"',
                  '"Write a 200-word summary of the causes of World War I for a 10th grade history class"',
                  '"History stuff please"',
                  '"Do the thing"',
                ],
                correctIndex: 1,
                explanation: 'The second option specifies the format (summary), length (200 words), topic (causes of WWI), and audience (10th graders). This gives the AI clear constraints and context, leading to a much more useful response.',
              },
              {
                id: 'q-wpm-3',
                question: 'Why do small wording changes in prompts sometimes produce very different AI outputs?',
                options: [
                  'Because AI is random and unpredictable',
                  'Because AI models are sensitive to context and interpret different words as signals for different types of responses',
                  'Because AI cannot understand English well',
                  'Because each word activates a different AI model',
                ],
                correctIndex: 1,
                explanation: 'AI models process every word as part of a pattern that influences the response. Different words carry different contextual signals — "explain" triggers a different style than "list," and "for a beginner" signals a different complexity level than "in technical detail."',
              },
            ],
          },
          {
            id: 'craft-framework',
            title: 'The CRAFT Framework',
            subtitle: 'A systematic approach to great prompts',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'Introducing CRAFT',
                content: 'CRAFT is a framework for building effective prompts. It stands for Context, Role, Action, Format, and Tone. By including each of these elements, you give the AI everything it needs to produce exactly the response you want. Not every prompt needs all five elements, but using CRAFT as a checklist ensures you do not miss anything important.',
                bulletPoints: [
                  'C — Context: background information and situation',
                  'R — Role: who the AI should pretend to be',
                  'A — Action: the specific task to perform',
                  'F — Format: how the output should be structured',
                  'T — Tone: the style and voice of the response',
                ],
              },
              {
                type: 'explore',
                title: 'CRAFT in Action',
                content: 'Here is CRAFT applied: Context — "I am a 14-year-old preparing for a science fair." Role — "Act as a science teacher." Action — "Suggest three original experiment ideas about renewable energy." Format — "List each idea with a title, hypothesis, and materials needed." Tone — "Encouraging and easy to understand." Combined, this produces a prompt far more useful than "Give me science fair ideas."',
              },
              {
                type: 'challenge',
                title: 'Build Your Own CRAFT Prompt',
                content: 'Choose a school assignment you are currently working on. Build a CRAFT prompt for it by filling in each element. Then test your prompt with an AI assistant and compare the result to what you would get from a simple one-line request. Document what was different and what you would change in your prompt.',
              },
              {
                type: 'connect',
                title: 'Share and Compare',
                content: 'CRAFT prompts can be shared and iterated on just like code. In professional settings, teams maintain prompt libraries — collections of tested, effective prompts for common tasks. As you develop your skills, start saving your best prompts and noting what made them work well.',
              },
            ],
            quiz: [
              {
                id: 'q-cf-1',
                question: 'What does the "R" in CRAFT stand for?',
                options: [
                  'Results',
                  'Role',
                  'Research',
                  'Repeat',
                ],
                correctIndex: 1,
                explanation: 'The R in CRAFT stands for Role — the persona or expert identity you want the AI to adopt. For example, "Act as a nutritionist" or "You are a patient history tutor." This shapes the perspective and expertise level of the response.',
              },
              {
                id: 'q-cf-2',
                question: 'Why is specifying Format important in a prompt?',
                options: [
                  'It makes the AI respond faster',
                  'It tells the AI how to structure its output so you get information in the most useful form',
                  'AI cannot respond without a format specified',
                  'Format only matters for image generation, not text',
                ],
                correctIndex: 1,
                explanation: 'Specifying format (bullet list, table, essay, step-by-step guide, etc.) ensures the AI delivers information in the structure most useful for your needs. Without format guidance, the AI chooses its own structure, which may not match what you need.',
              },
              {
                id: 'q-cf-3',
                question: 'Which CRAFT element would you use to tell the AI "explain this as if I am 10 years old"?',
                options: [
                  'Context',
                  'Action',
                  'Format',
                  'Tone',
                ],
                correctIndex: 3,
                explanation: 'Tone controls the style, complexity, and voice of the response. "Explain as if I am 10 years old" sets a tone that is simple, friendly, and avoids jargon. It could also partially fall under Context (providing audience info), but Tone most directly controls the communication style.',
              },
            ],
          },
          {
            id: 'prompt-chains',
            title: 'Prompt Chains & Iteration',
            subtitle: 'Building complex results step by step',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Are Prompt Chains?',
                content: 'A prompt chain is a series of prompts where each one builds on the output of the previous one. Instead of trying to get a perfect result in one shot, you break complex tasks into smaller steps. First, you might ask the AI to brainstorm ideas. Then you pick the best idea and ask the AI to develop it. Then you ask the AI to refine the result. Each step is simpler and more focused.',
                bulletPoints: [
                  'Break complex tasks into a sequence of simpler prompts',
                  'Each prompt uses the output of the previous one as input',
                  'Allows you to guide and correct the AI at each step',
                  'Produces higher quality results than single-prompt approaches',
                ],
              },
              {
                type: 'explore',
                title: 'Iteration Is Key',
                content: 'Almost no prompt is perfect on the first try. Iteration means refining your prompt based on what the AI gives you. If the response is too long, add a length constraint. If it misses the point, clarify your goal. If the tone is wrong, adjust your tone instruction. Professional prompt engineers often go through 5-10 iterations to develop a prompt that consistently produces great results.',
              },
              {
                type: 'challenge',
                title: 'Chain It Up',
                content: 'Try this prompt chain: (1) Ask AI to list 5 debate topics about technology in schools. (2) Pick one and ask AI to write arguments for both sides. (3) Ask AI to identify the strongest argument from each side. (4) Ask AI to write a balanced conclusion. Notice how each step produces a more refined result than asking for the final product directly.',
              },
              {
                type: 'reflect',
                title: 'Patience Produces Quality',
                content: 'The instinct to get everything in one prompt is natural but counterproductive. The best AI users are patient — they treat the interaction as a conversation, not a one-time request. This mirrors how real work gets done: through drafts, feedback, and revision.',
              },
            ],
            quiz: [
              {
                id: 'q-pc-1',
                question: 'What is a prompt chain?',
                options: [
                  'A way to lock AI with a password',
                  'A series of prompts where each builds on the previous output',
                  'A type of blockchain for AI',
                  'Multiple AI models connected together',
                ],
                correctIndex: 1,
                explanation: 'A prompt chain is a sequence of prompts where each step uses or builds on the output from the previous step, allowing you to break complex tasks into manageable pieces and guide the AI toward better results incrementally.',
              },
              {
                id: 'q-pc-2',
                question: 'Why is iteration important in prompt engineering?',
                options: [
                  'Because AI always gives wrong answers the first time',
                  'Because refining prompts based on results leads to higher quality outputs',
                  'Because you get charged less for repeated prompts',
                  'Because AI requires exactly three attempts to work properly',
                ],
                correctIndex: 1,
                explanation: 'Iteration is important because prompts rarely produce perfect results on the first try. By examining the output and adjusting your prompt — adding constraints, clarifying goals, or changing the approach — you converge on consistently excellent results.',
              },
              {
                id: 'q-pc-3',
                question: 'What is the main advantage of breaking a complex task into a prompt chain rather than a single prompt?',
                options: [
                  'It uses less computing power',
                  'It lets you guide and correct the AI at each step, producing better final results',
                  'Single prompts are not allowed for complex tasks',
                  'AI can only process one sentence at a time',
                ],
                correctIndex: 1,
                explanation: 'Prompt chains let you review and steer the output at each step. If the AI goes in the wrong direction at step 2, you can correct it before step 3. This control produces much better final results than hoping a single complex prompt will work perfectly.',
              },
            ],
          },
          {
            id: 'verifying-ai-output',
            title: 'Verifying AI Output',
            subtitle: 'Trust but verify everything AI tells you',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'AI Can Be Confidently Wrong',
                content: 'AI models can generate text that sounds authoritative and well-written but is completely false. This is called "hallucination" — the model produces plausible-sounding information that has no basis in fact. It might cite studies that do not exist, invent statistics, or confidently state incorrect facts. The fluency of the writing makes these errors harder to catch.',
                bulletPoints: [
                  'AI hallucinations are confident-sounding false statements',
                  'Models can invent fake citations, statistics, and facts',
                  'Fluent writing does not mean accurate writing',
                  'Even the best models hallucinate — it is a fundamental limitation',
                ],
              },
              {
                type: 'learn',
                title: 'Verification Strategies',
                content: 'Always cross-reference important AI-generated claims with reliable sources. Check cited sources to see if they actually exist. Look for internal consistency — does the AI contradict itself? Be especially skeptical of specific numbers, dates, and quotes, which are common hallucination points. When in doubt, ask the AI to explain its reasoning step by step.',
                bulletPoints: [
                  'Cross-check facts with reliable, independent sources',
                  'Verify that cited sources actually exist',
                  'Be skeptical of specific numbers, dates, and quotes',
                  'Ask the AI to show its reasoning step by step',
                  'Use multiple AI tools and compare their answers',
                ],
              },
              {
                type: 'challenge',
                title: 'Spot the Hallucination',
                content: 'Ask an AI assistant to write a short biography of a relatively obscure historical figure. Then fact-check every claim using Wikipedia or other reliable sources. How many details did the AI get right? Did it invent any facts? This exercise builds your critical evaluation muscles and teaches you never to blindly trust AI output.',
              },
              {
                type: 'reflect',
                title: 'A New Kind of Literacy',
                content: 'Verifying AI output is a new form of literacy that is becoming essential. Just as you learned to evaluate whether a website is trustworthy, you now need to evaluate whether AI-generated content is accurate. The people who will thrive in the AI age are not those who blindly trust AI or those who refuse to use it — but those who use it critically.',
              },
            ],
            quiz: [
              {
                id: 'q-vao-1',
                question: 'What is an AI "hallucination"?',
                options: [
                  'When an AI sees images that are not there',
                  'When an AI generates confident-sounding but false information',
                  'When an AI crashes and shows error messages',
                  'When an AI dreams during downtime',
                ],
                correctIndex: 1,
                explanation: 'An AI hallucination is when the model generates information that sounds plausible and authoritative but is actually false — such as made-up facts, fake citations, or invented statistics. The confident tone makes these errors especially dangerous.',
              },
              {
                id: 'q-vao-2',
                question: 'Which type of AI-generated content should you be MOST skeptical about?',
                options: [
                  'General explanations of well-known concepts',
                  'Specific numbers, dates, quotes, and citations',
                  'Simple yes or no answers',
                  'Formatting and text structure',
                ],
                correctIndex: 1,
                explanation: 'Specific details like numbers, dates, quotes, and citations are the most common hallucination points. AI models are more likely to invent specific details than to get broad concepts wrong, because specific facts require precise recall that models often lack.',
              },
              {
                id: 'q-vao-3',
                question: 'What is the best approach to using AI-generated information?',
                options: [
                  'Never use AI because it might be wrong',
                  'Always trust AI because it is smarter than humans',
                  'Use AI as a starting point but verify important claims with reliable sources',
                  'Only use AI for entertainment, never for learning',
                ],
                correctIndex: 2,
                explanation: 'The best approach is to use AI as a powerful tool while maintaining healthy skepticism. Use it to generate ideas, draft content, and explore topics, but always verify important facts and claims with reliable, independent sources.',
              },
            ],
          },
        ],
      },
      // MODULE 4: AI Image & Media
      {
        id: 'ai-creation',
        title: 'AI Image & Media',
        subtitle: 'Creating with AI tools',
        description: 'Learn how AI generates images and media, master text-to-image prompting, and understand the challenges of deepfakes and digital authenticity.',
        icon: 'image',
        color: '#22c55e',
        difficulty: 'intermediate',
        ageRange: '13-16',
        badgeId: 'badge-ai-creation',
        badgeName: 'Digital Creator',
        lessons: [
          {
            id: 'how-image-ai-works',
            title: 'How Image AI Works',
            subtitle: 'From noise to pictures',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Diffusion Models Explained',
                content: 'Most modern image AI uses diffusion models. The idea is surprisingly elegant: start with pure random noise (like TV static) and gradually remove the noise step by step until a clear image emerges. During training, the model learns how to reverse the process of adding noise to real images. When generating, it applies this learned denoising to transform noise into coherent pictures guided by your text prompt.',
                bulletPoints: [
                  'Training: the model learns to remove noise from images',
                  'Generation: starts with random noise and iteratively denoises it',
                  'Text guidance: your prompt steers what the denoised image looks like',
                  'Each denoising step makes the image slightly clearer and more detailed',
                ],
              },
              {
                type: 'explore',
                title: 'GANs and Other Approaches',
                content: 'Before diffusion models, Generative Adversarial Networks (GANs) were the leading image AI technique. GANs work by pitting two neural networks against each other: a generator that creates images and a discriminator that tries to tell real from fake. They push each other to improve, like a forger and a detective in an arms race. While diffusion models now dominate, GANs pioneered the field of AI image generation.',
              },
              {
                type: 'challenge',
                title: 'Visualize the Process',
                content: 'Draw or sketch what you think happens during the diffusion process. Start with a square of random dots, then show 4-5 steps where the image gradually takes shape. Label each step. This exercise helps you internalize that AI image generation is a gradual refinement, not instant creation.',
              },
              {
                type: 'reflect',
                title: 'Art or Algorithm?',
                content: 'If a model was trained on millions of human artworks, who deserves credit for the images it generates? The artists whose work trained the model? The person who wrote the prompt? The engineers who built the system? There is no easy answer, and this question is at the center of ongoing debates about AI art and copyright.',
              },
            ],
            quiz: [
              {
                id: 'q-hiaw-1',
                question: 'How do diffusion models generate images?',
                options: [
                  'By assembling images from a library of pre-made parts',
                  'By starting with random noise and gradually removing it to form a coherent image',
                  'By copying and pasting from images found on the internet',
                  'By drawing one pixel at a time from left to right',
                ],
                correctIndex: 1,
                explanation: 'Diffusion models start with pure random noise and iteratively denoise it, guided by the text prompt. Each step removes some noise and adds structure, gradually transforming static into a clear image that matches the prompt.',
              },
              {
                id: 'q-hiaw-2',
                question: 'In a GAN, what are the two competing networks?',
                options: [
                  'A reader and a writer',
                  'A generator and a discriminator',
                  'A compressor and a decompressor',
                  'An encoder and a decoder',
                ],
                correctIndex: 1,
                explanation: 'GANs consist of a generator (which creates fake images) and a discriminator (which tries to distinguish real images from generated ones). Their competition drives both to improve — the generator makes more realistic images while the discriminator gets better at detecting fakes.',
              },
              {
                id: 'q-hiaw-3',
                question: 'What role does the text prompt play in diffusion model image generation?',
                options: [
                  'It names the output file',
                  'It guides the denoising process to produce an image matching the description',
                  'It selects a pre-existing image from a database',
                  'It has no effect — images are randomly generated',
                ],
                correctIndex: 1,
                explanation: 'The text prompt is encoded into a numerical representation that guides each denoising step. At every iteration, the model uses the prompt to steer the noise removal toward producing an image that matches the textual description.',
              },
            ],
          },
          {
            id: 'text-to-image-prompting',
            title: 'Text-to-Image Prompting',
            subtitle: 'Painting with words',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Anatomy of an Image Prompt',
                content: 'A great text-to-image prompt has several components: the subject (what you want to see), the style (how it should look), the details (specific attributes), and technical modifiers (lighting, camera angle, quality). Order matters — words at the beginning of your prompt typically have more influence than words at the end.',
                bulletPoints: [
                  'Subject: the main thing in the image (a dragon, a city, a portrait)',
                  'Style: artistic direction (watercolor, photorealistic, anime, oil painting)',
                  'Details: colors, materials, expressions, environment',
                  'Technical: lighting, camera angle, resolution keywords',
                  'Negative prompts: things to exclude from the image',
                ],
              },
              {
                type: 'explore',
                title: 'Style and Mood Keywords',
                content: 'Knowing the right vocabulary is your superpower. Words like "cinematic lighting" create dramatic shadows. "Golden hour" gives warm sunset tones. "Studio Ghibli style" evokes Japanese animation aesthetics. "Tilt-shift photography" creates a miniature effect. Building a vocabulary of effective style keywords dramatically improves your results.',
              },
              {
                type: 'challenge',
                title: 'The Same Subject, Five Styles',
                content: 'Choose a simple subject like "a cat sitting on a windowsill." Write five prompts for the same scene in completely different styles: photorealistic, watercolor, pixel art, noir film, and fantasy illustration. Compare how different style keywords transform the same subject into completely different images.',
              },
              {
                type: 'connect',
                title: 'Building Your Prompt Library',
                content: 'Professional AI artists maintain prompt libraries — collections of tested phrases and formulas that produce reliable results. Start your own. Save prompts that work well, note which keywords had the biggest impact, and build a personal reference of effective techniques you can reuse and remix.',
              },
            ],
            quiz: [
              {
                id: 'q-ttip-1',
                question: 'Which component of an image prompt has the MOST influence on the result?',
                options: [
                  'Words at the end of the prompt',
                  'Punctuation marks',
                  'Words at the beginning of the prompt',
                  'The total number of words',
                ],
                correctIndex: 2,
                explanation: 'In most image generation models, words at the beginning of the prompt carry the most weight and influence. This is why you should put your most important elements — the subject and primary style — at the start of your prompt.',
              },
              {
                id: 'q-ttip-2',
                question: 'What is a "negative prompt"?',
                options: [
                  'A prompt that generates sad images',
                  'A list of things you want excluded from the generated image',
                  'A prompt written in a negative tone',
                  'A prompt that makes the AI refuse to generate',
                ],
                correctIndex: 1,
                explanation: 'A negative prompt specifies elements you want the model to avoid including in the generated image. For example, "no text, no watermarks, no blurry" helps the model steer away from common unwanted artifacts.',
              },
              {
                id: 'q-ttip-3',
                question: 'Why should you build a prompt library?',
                options: [
                  'Because AI companies require you to save all prompts',
                  'Because tested, effective phrases can be reused and refined for consistent quality',
                  'Because prompts expire after one use',
                  'Because you need at least 100 prompts before AI will respond',
                ],
                correctIndex: 1,
                explanation: 'A prompt library saves you time and improves consistency. By recording what works, you build a personal toolkit of reliable techniques, keywords, and formulas that you can adapt for new projects instead of starting from scratch each time.',
              },
            ],
          },
          {
            id: 'deepfakes-authenticity',
            title: 'Deepfakes & Authenticity',
            subtitle: 'When seeing is no longer believing',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Are Deepfakes?',
                content: 'Deepfakes are AI-generated or AI-manipulated media that make it appear someone said or did something they never actually did. Using techniques like face-swapping and voice cloning, creators can produce videos and audio that are increasingly difficult to distinguish from real recordings. The technology has advanced so rapidly that even experts sometimes struggle to identify deepfakes.',
                bulletPoints: [
                  'Face-swapping: replacing one person\'s face with another in video',
                  'Voice cloning: generating speech in someone\'s voice from text',
                  'Lip-syncing: making someone appear to say words they never spoke',
                  'Full-body synthesis: generating entire people who do not exist',
                ],
              },
              {
                type: 'explore',
                title: 'The Danger and the Potential',
                content: 'Deepfakes pose serious risks: political misinformation, fraud, harassment, and erosion of trust in media. However, the same technology also has positive uses — dubbing films into other languages with matching lip movements, bringing historical figures to life in educational settings, and creating accessible content. The technology is neutral; the intent behind its use determines whether it is harmful or beneficial.',
              },
              {
                type: 'learn',
                title: 'Detection and Defense',
                content: 'Researchers are developing tools to detect deepfakes by looking for subtle artifacts: inconsistent lighting, unnatural blinking patterns, skin texture anomalies, and audio-visual mismatches. Digital watermarking and content provenance systems like C2PA embed verifiable metadata into media at the point of capture, creating a chain of custody that can prove authenticity.',
                bulletPoints: [
                  'Look for inconsistent lighting and shadows',
                  'Check for unnatural facial movements or blinking',
                  'Listen for audio artifacts and unnatural speech rhythms',
                  'Use reverse image search to find original sources',
                  'Check for C2PA or similar provenance metadata',
                ],
              },
              {
                type: 'reflect',
                title: 'Living in a Post-Truth World',
                content: 'As AI-generated media becomes indistinguishable from real media, we need new frameworks for determining what is real. Critical thinking, source verification, and media literacy become more important than ever. Your generation will need to build and maintain trust systems that work in a world where any image, video, or audio could be synthetic.',
              },
            ],
            quiz: [
              {
                id: 'q-da-1',
                question: 'What is a deepfake?',
                options: [
                  'A very convincing practical joke',
                  'AI-generated or manipulated media that makes it appear someone said or did something they did not',
                  'A type of computer virus that corrupts image files',
                  'A low-quality fake video made with basic editing software',
                ],
                correctIndex: 1,
                explanation: 'Deepfakes use AI techniques like face-swapping and voice cloning to create realistic but fabricated media. The "deep" refers to deep learning, the AI technology that makes them possible.',
              },
              {
                id: 'q-da-2',
                question: 'Which is NOT a common method for detecting deepfakes?',
                options: [
                  'Checking for inconsistent lighting and shadows',
                  'Looking for unnatural blinking or facial movements',
                  'Counting the number of pixels in the image',
                  'Checking for content provenance metadata like C2PA',
                ],
                correctIndex: 2,
                explanation: 'Simply counting pixels tells you the resolution of an image, not whether it is real or fake. Effective detection methods look for subtle artifacts in lighting, facial movements, and audio, or rely on cryptographic provenance systems that verify the origin of media.',
              },
              {
                id: 'q-da-3',
                question: 'What is content provenance (like C2PA)?',
                options: [
                  'A social media platform for sharing verified content',
                  'A system that embeds verifiable metadata into media to prove its origin and authenticity',
                  'A law that requires all content to be labeled',
                  'A type of watermark visible to the naked eye',
                ],
                correctIndex: 1,
                explanation: 'Content provenance systems like C2PA (Coalition for Content Provenance and Authenticity) embed cryptographically signed metadata into media at the point of capture. This creates a verifiable chain of custody that can prove where and how media was created.',
              },
            ],
          },
        ],
      },
      // MODULE 5: AI + Coding
      {
        id: 'ai-coding',
        title: 'AI + Coding',
        subtitle: 'From user to creator',
        description: 'Move beyond using AI to building with it. Learn Python basics, use AI coding assistants, and create your own AI-powered projects.',
        icon: 'code',
        color: '#22c55e',
        difficulty: 'intermediate',
        ageRange: '14-18',
        badgeId: 'badge-ai-coding',
        badgeName: 'AI Builder',
        lessons: [
          {
            id: 'python-ai-basics',
            title: 'Python for AI Basics',
            subtitle: 'The language of AI',
            xpReward: 75,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Why Python?',
                content: 'Python is the dominant language in AI and machine learning for good reasons: its syntax reads almost like English, it has a massive ecosystem of AI libraries, and it has the largest community of AI practitioners. Libraries like NumPy, Pandas, and scikit-learn make complex math and data manipulation simple, while TensorFlow and PyTorch provide powerful deep learning frameworks.',
                bulletPoints: [
                  'Clean, readable syntax that is beginner-friendly',
                  'NumPy: fast numerical computing with arrays and matrices',
                  'Pandas: data manipulation and analysis',
                  'scikit-learn: classical machine learning algorithms',
                  'PyTorch and TensorFlow: deep learning frameworks',
                ],
              },
              {
                type: 'explore',
                title: 'Your First AI Code',
                content: 'A simple machine learning program in Python can be written in under 10 lines. Using scikit-learn, you can load a dataset, split it into training and test sets, train a classifier, and evaluate its accuracy. The library handles all the complex math behind the scenes. Understanding what each line does is more important than memorizing syntax.',
              },
              {
                type: 'challenge',
                title: 'Set Up Your Environment',
                content: 'Install Python and set up a virtual environment for AI work. Install NumPy, Pandas, and scikit-learn. Write a script that loads the famous Iris dataset (built into scikit-learn), prints the first 5 rows, and reports how many samples are in each class. This gets your hands dirty with real data science tools.',
              },
              {
                type: 'connect',
                title: 'From Notebooks to Production',
                content: 'Data scientists often start in Jupyter Notebooks — interactive environments where you can write and run code in small chunks and see results immediately. As projects mature, code moves to standard Python files and then to production systems. Understanding both workflows is valuable.',
              },
            ],
            quiz: [
              {
                id: 'q-pab-1',
                question: 'Why is Python the most popular language for AI development?',
                options: [
                  'It is the fastest programming language available',
                  'It has readable syntax and a massive ecosystem of AI libraries',
                  'It was specifically designed for AI and nothing else',
                  'It is the only language that supports machine learning',
                ],
                correctIndex: 1,
                explanation: 'Python dominates AI because of its clean, readable syntax and its extensive ecosystem of libraries (NumPy, Pandas, scikit-learn, PyTorch, TensorFlow). While not the fastest language, its ease of use and library support make it the top choice for AI work.',
              },
              {
                id: 'q-pab-2',
                question: 'What is scikit-learn primarily used for?',
                options: [
                  'Building websites',
                  'Classical machine learning algorithms like classification and regression',
                  'Playing video games',
                  'Editing images',
                ],
                correctIndex: 1,
                explanation: 'scikit-learn is a Python library that provides simple, efficient tools for classical machine learning tasks including classification, regression, clustering, and model evaluation. It is the go-to library for traditional ML before moving to deep learning.',
              },
              {
                id: 'q-pab-3',
                question: 'What is a Jupyter Notebook?',
                options: [
                  'A physical notebook for writing code by hand',
                  'An interactive environment where you can write and run code in chunks and see results immediately',
                  'A type of laptop designed for programming',
                  'A note-taking app that has nothing to do with coding',
                ],
                correctIndex: 1,
                explanation: 'Jupyter Notebooks are interactive coding environments that let you write code in cells, run each cell independently, and see results (including visualizations) immediately below the code. They are widely used in data science and AI for exploration and prototyping.',
              },
            ],
          },
          {
            id: 'ai-coding-assistants',
            title: 'Using AI Coding Assistants',
            subtitle: 'Your AI pair programmer',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'How AI Coding Assistants Work',
                content: 'AI coding assistants like GitHub Copilot and Claude are large language models trained on vast amounts of code. They can autocomplete your code, explain error messages, suggest fixes, generate functions from descriptions, and even write entire programs from natural language specifications. They work best as collaborators — you guide the direction while they handle repetitive coding tasks.',
                bulletPoints: [
                  'Code autocomplete: predicting the next lines of code',
                  'Code explanation: describing what complex code does',
                  'Bug fixing: identifying and suggesting fixes for errors',
                  'Code generation: writing functions from natural language descriptions',
                  'Refactoring: improving code structure while maintaining functionality',
                ],
              },
              {
                type: 'explore',
                title: 'Best Practices for AI-Assisted Coding',
                content: 'To get the most from AI coding assistants, write clear comments and docstrings that describe what you want, review every line of generated code before accepting it, and always test the output. Never paste sensitive data like passwords or API keys into AI tools. Think of the AI as a junior developer who is fast but needs supervision.',
              },
              {
                type: 'challenge',
                title: 'AI Pair Programming Session',
                content: 'Pick a small coding project — like a to-do list app or a number guessing game. Write the specification in plain English, then use an AI assistant to help you code it. Track how many of the AI suggestions you accepted, modified, or rejected. Write notes about what the AI did well and where it struggled.',
              },
              {
                type: 'reflect',
                title: 'Should You Still Learn to Code?',
                content: 'Absolutely. AI assistants amplify your coding ability — they do not replace it. You need to understand code to evaluate what the AI generates, spot bugs, architect systems, and make design decisions. Programmers who use AI assistants are more productive, but they still need to understand the fundamentals deeply.',
              },
            ],
            quiz: [
              {
                id: 'q-aca-1',
                question: 'How should you treat code generated by an AI assistant?',
                options: [
                  'Accept it immediately — AI code is always correct',
                  'Review every line, test it, and modify as needed before using it',
                  'Never use it — AI-generated code is always buggy',
                  'Copy it without reading it to save time',
                ],
                correctIndex: 1,
                explanation: 'AI-generated code should always be reviewed and tested. While AI assistants can produce correct, high-quality code, they can also introduce bugs, security vulnerabilities, or logic errors. Treating AI output as a draft that needs human review is the safest approach.',
              },
              {
                id: 'q-aca-2',
                question: 'What should you NEVER paste into an AI coding assistant?',
                options: [
                  'Error messages',
                  'Code comments',
                  'Passwords, API keys, or sensitive credentials',
                  'Function names',
                ],
                correctIndex: 2,
                explanation: 'Never paste sensitive information like passwords, API keys, database credentials, or personal data into AI tools. This data could be stored or processed in ways you cannot control, potentially creating security vulnerabilities.',
              },
              {
                id: 'q-aca-3',
                question: 'Why is learning to code still important even with AI assistants?',
                options: [
                  'Because AI assistants will be banned soon',
                  'Because you need coding knowledge to evaluate AI output, spot bugs, and make design decisions',
                  'Because AI assistants only work for experienced programmers',
                  'Because AI cannot write any type of code',
                ],
                correctIndex: 1,
                explanation: 'Coding knowledge is essential for evaluating whether AI-generated code is correct, efficient, and secure. You also need it for system design, debugging, and making architectural decisions that AI assistants cannot handle on their own.',
              },
            ],
          },
          {
            id: 'building-a-chatbot',
            title: 'Building a Chatbot',
            subtitle: 'Your first AI application',
            xpReward: 75,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Chatbot Architecture',
                content: 'A chatbot connects a user interface to an AI model through an API (Application Programming Interface). The basic flow is: user types a message, your code sends it to the AI API along with a system prompt and conversation history, the API returns a response, and your code displays it. Understanding this architecture lets you build any conversational AI application.',
                bulletPoints: [
                  'User interface: where the user types messages and reads responses',
                  'System prompt: instructions that define the chatbot\'s behavior',
                  'Conversation history: previous messages that provide context',
                  'API call: sending the message to the AI model and receiving a response',
                  'Response handling: displaying the result and managing errors',
                ],
              },
              {
                type: 'explore',
                title: 'System Prompts Shape Personality',
                content: 'The system prompt is your most powerful tool for defining a chatbot\'s behavior. It tells the AI who it is, how it should respond, what topics it should cover, and what it should refuse to discuss. A well-crafted system prompt can turn the same base model into a friendly tutor, a strict quiz master, a creative writing partner, or a customer service agent.',
              },
              {
                type: 'challenge',
                title: 'Build It',
                content: 'Using Python and an AI API, build a simple chatbot with a custom personality. Write a system prompt that makes it an expert in a topic you care about. Add conversation history so it remembers what was discussed. Handle errors gracefully when the API is unavailable. Test it with at least 10 different questions.',
              },
              {
                type: 'connect',
                title: 'Beyond Text Chat',
                content: 'Modern chatbots can do more than text conversation. They can call functions (like searching databases or booking appointments), process images, generate and execute code, and interact with external tools. These capabilities are what turn simple chatbots into useful AI agents.',
              },
            ],
            quiz: [
              {
                id: 'q-bac-1',
                question: 'What is the role of a system prompt in a chatbot?',
                options: [
                  'It is the first message the user types',
                  'It defines the chatbot\'s behavior, personality, and constraints',
                  'It is a secret password required to access the chatbot',
                  'It is an error message shown when the chatbot fails',
                ],
                correctIndex: 1,
                explanation: 'The system prompt is a set of instructions given to the AI model that defines how the chatbot should behave. It establishes the persona, expertise, communication style, and any rules or limitations the chatbot should follow.',
              },
              {
                id: 'q-bac-2',
                question: 'Why is conversation history important for a chatbot?',
                options: [
                  'It is required by law to store all conversations',
                  'It provides context so the AI can give relevant responses that build on previous messages',
                  'It makes the chatbot respond faster',
                  'It is only used for billing purposes',
                ],
                correctIndex: 1,
                explanation: 'Conversation history gives the AI context about what has already been discussed. Without it, every message would be treated in isolation, and the chatbot could not refer back to earlier parts of the conversation or maintain coherent multi-turn dialogue.',
              },
              {
                id: 'q-bac-3',
                question: 'What is an API in the context of building a chatbot?',
                options: [
                  'A programming language for AI',
                  'A type of chatbot personality',
                  'An interface that lets your code send messages to an AI model and receive responses',
                  'A visual design tool for chat interfaces',
                ],
                correctIndex: 2,
                explanation: 'An API (Application Programming Interface) is a way for your code to communicate with external services. In chatbot development, you use an API to send user messages to an AI model hosted in the cloud and receive the generated response back.',
              },
            ],
          },
          {
            id: 'your-ai-project',
            title: 'Your AI Project',
            subtitle: 'Bringing it all together',
            xpReward: 75,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Project Planning',
                content: 'Every great AI project starts with a clear problem statement. What problem are you solving? Who will use your solution? What data do you need? A well-defined project scope prevents you from getting lost in endless possibilities. Start small — a focused tool that does one thing well is better than an ambitious project that never gets finished.',
                bulletPoints: [
                  'Define the problem clearly in one or two sentences',
                  'Identify your target user and their needs',
                  'List the data and tools you will need',
                  'Set realistic milestones with deadlines',
                  'Plan for testing and iteration',
                ],
              },
              {
                type: 'explore',
                title: 'Project Ideas',
                content: 'Consider projects that combine AI with your personal interests. A study assistant that quizzes you on your notes. A creative writing tool that helps you brainstorm story ideas. A homework helper that explains math problems step by step. A mood tracker that uses natural language to identify emotional patterns. The best projects solve real problems in your own life.',
              },
              {
                type: 'challenge',
                title: 'Build Your MVP',
                content: 'Choose a project idea and build a Minimum Viable Product (MVP) — the simplest version that demonstrates the core concept. Write a project plan, build the core feature, test it with at least three other people, and document what you learned. Focus on making one feature work really well rather than building many features poorly.',
              },
              {
                type: 'reflect',
                title: 'The Builder Mindset',
                content: 'By completing this project, you have crossed an important threshold: from AI consumer to AI creator. You now understand not just how to use AI tools, but how to build with them. This builder mindset — seeing technology as something you can shape, not just something that happens to you — is transformative.',
              },
            ],
            quiz: [
              {
                id: 'q-yap-1',
                question: 'What is an MVP (Minimum Viable Product)?',
                options: [
                  'The most expensive version of a product',
                  'The simplest version of a product that demonstrates the core concept and is usable',
                  'A product that has every possible feature',
                  'A product that is minimum quality and barely works',
                ],
                correctIndex: 1,
                explanation: 'An MVP is the simplest functional version of your product that lets you test the core idea with real users. It includes just enough features to demonstrate value and gather feedback, without spending time on bells and whistles that may not matter.',
              },
              {
                id: 'q-yap-2',
                question: 'Why should you start with a focused, small AI project?',
                options: [
                  'Because AI can only handle small projects',
                  'Because a focused project is more likely to be completed and to work well',
                  'Because large projects are not allowed for beginners',
                  'Because small projects are cheaper to run',
                ],
                correctIndex: 1,
                explanation: 'Starting small lets you focus your energy on making one thing work well. A finished small project that solves a real problem is more valuable (and teaches you more) than an ambitious project that never gets completed.',
              },
              {
                id: 'q-yap-3',
                question: 'What is the most important first step in planning an AI project?',
                options: [
                  'Choosing which programming language to use',
                  'Defining a clear problem statement — what problem you are solving and for whom',
                  'Designing the user interface',
                  'Finding investors',
                ],
                correctIndex: 1,
                explanation: 'A clear problem statement guides every subsequent decision in your project. Without it, you risk building something that does not solve a real need or getting lost in the many possibilities AI offers. Start with the problem, then work toward the solution.',
              },
            ],
          },
        ],
      },
      // MODULE 6: AI Ethics & Society
      {
        id: 'ai-ethics',
        title: 'AI Ethics & Society',
        subtitle: 'Power and responsibility',
        description: 'Explore the ethical challenges of AI including bias, privacy, job displacement, and the rights we should demand in an AI-powered world.',
        icon: 'scale',
        color: '#22c55e',
        difficulty: 'intermediate',
        ageRange: 'all',
        badgeId: 'badge-ai-ethics',
        badgeName: 'Ethics Champion',
        lessons: [
          {
            id: 'algorithmic-bias',
            title: 'Algorithmic Bias',
            subtitle: 'When AI inherits our prejudices',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Is Algorithmic Bias?',
                content: 'Algorithmic bias occurs when an AI system produces systematically unfair results for certain groups of people. This usually happens because the training data reflects historical inequalities or because the people building the system did not consider all perspectives. Bias can appear in hiring tools, loan approvals, criminal justice risk scores, facial recognition, and many other applications.',
                bulletPoints: [
                  'Data bias: training data that over- or under-represents certain groups',
                  'Selection bias: choosing data that does not represent the real world',
                  'Measurement bias: using proxies that correlate with protected characteristics',
                  'Confirmation bias: developers testing only scenarios that confirm their assumptions',
                ],
              },
              {
                type: 'explore',
                title: 'Real Cases of AI Bias',
                content: 'Facial recognition systems have been shown to be significantly less accurate for darker-skinned faces and women, because training datasets were dominated by lighter-skinned male faces. Predictive policing algorithms sent more officers to minority neighborhoods, creating a feedback loop where more policing led to more arrests which "confirmed" the algorithm\'s prediction.',
              },
              {
                type: 'challenge',
                title: 'Bias Detective',
                content: 'Choose an AI system you interact with regularly (social media recommendations, search results, voice assistants). Spend a week documenting cases where you notice potential bias. Does it favor certain types of content? Does it understand some accents better than others? Does it make assumptions about you based on demographics? Present your findings.',
              },
              {
                type: 'reflect',
                title: 'Fairness Is Complicated',
                content: 'There are multiple mathematical definitions of fairness, and they cannot all be satisfied simultaneously. Should an AI treat everyone identically (equal treatment) or produce equal outcomes (equal impact)? These are not just technical questions — they are deeply moral ones that require input from diverse communities, not just engineers.',
              },
            ],
            quiz: [
              {
                id: 'q-ab-1',
                question: 'What is the primary cause of algorithmic bias?',
                options: [
                  'AI systems are intentionally programmed to be biased',
                  'Training data that reflects historical inequalities and lack of diverse perspectives in development',
                  'Computers are naturally biased against certain groups',
                  'AI bias only exists in science fiction',
                ],
                correctIndex: 1,
                explanation: 'Algorithmic bias primarily stems from biased training data (which reflects historical inequalities) and from development teams that lack diverse perspectives. The AI learns and amplifies patterns in its data, including unfair ones.',
              },
              {
                id: 'q-ab-2',
                question: 'Why were some facial recognition systems less accurate for darker-skinned faces?',
                options: [
                  'Because the cameras could not capture darker skin',
                  'Because the training datasets were dominated by lighter-skinned faces',
                  'Because darker skin is technically harder for any system to analyze',
                  'Because those systems were designed for lighter-skinned people only',
                ],
                correctIndex: 1,
                explanation: 'The training datasets used to build early facial recognition systems contained far more images of lighter-skinned male faces. With fewer diverse examples to learn from, the models performed poorly on underrepresented groups.',
              },
              {
                id: 'q-ab-3',
                question: 'What is a feedback loop in the context of AI bias?',
                options: [
                  'When users provide feedback to improve the AI',
                  'When a biased AI\'s decisions create data that reinforces and amplifies the original bias',
                  'When an AI asks follow-up questions',
                  'When two AI systems communicate with each other',
                ],
                correctIndex: 1,
                explanation: 'A feedback loop occurs when a biased system\'s outputs become inputs for future decisions, amplifying the bias. For example, if biased policing AI sends more officers to a neighborhood, more arrests occur there, which the AI interprets as confirming the area is high-crime.',
              },
            ],
          },
          {
            id: 'privacy-surveillance',
            title: 'Privacy & Surveillance',
            subtitle: 'Who is watching and what do they know?',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'The Data You Generate',
                content: 'Every digital action you take generates data: your location, search queries, messages, browsing history, purchase patterns, and social connections. AI systems can combine these data points to build detailed profiles of your behavior, preferences, and even predict your future actions. Understanding what data you generate is the first step to protecting your privacy.',
                bulletPoints: [
                  'Location data from your phone tracks where you go',
                  'Search and browsing history reveal your interests and concerns',
                  'Purchase data shows your habits and financial status',
                  'Social media activity maps your relationships and beliefs',
                  'Combined, these create a "digital twin" profile of your life',
                ],
              },
              {
                type: 'explore',
                title: 'Surveillance Technologies',
                content: 'AI has supercharged surveillance capabilities. Facial recognition can identify you in crowds. Predictive analytics can flag you as "suspicious" based on behavior patterns. Social media monitoring can track your political views. Some countries use comprehensive social credit systems that use AI to score citizens based on their behavior. These technologies exist on a spectrum from security to oppression.',
              },
              {
                type: 'challenge',
                title: 'Privacy Audit',
                content: 'Conduct a personal privacy audit. Check the privacy settings on your top five apps. Download your data from Google or Apple to see what they have collected. Review which apps have access to your location, camera, and microphone. Make a list of changes you want to make to better protect your privacy.',
              },
              {
                type: 'reflect',
                title: 'The Privacy Paradox',
                content: 'Most people say they value privacy but do little to protect it — this is the privacy paradox. We trade our data for free services, accept cookie banners without reading them, and share personal details on social media. Understanding this paradox helps you make more intentional choices about what you share and with whom.',
              },
            ],
            quiz: [
              {
                id: 'q-ps-1',
                question: 'What is a "digital twin" in the context of privacy?',
                options: [
                  'A backup copy of your computer',
                  'A detailed profile built from your combined digital data that represents your behavior and preferences',
                  'A robot that looks like you',
                  'Your social media profile picture',
                ],
                correctIndex: 1,
                explanation: 'A digital twin (in the privacy context) is the comprehensive profile that emerges when all your digital data — location, searches, purchases, social activity — is combined. It can reveal intimate details about your life, habits, and even predict your future behavior.',
              },
              {
                id: 'q-ps-2',
                question: 'What is the "privacy paradox"?',
                options: [
                  'The fact that privacy software actually collects more data',
                  'People say they value privacy but often take little action to protect it',
                  'Privacy settings are impossible to find in apps',
                  'More privacy means less security',
                ],
                correctIndex: 1,
                explanation: 'The privacy paradox describes the gap between people\'s stated concern about privacy and their actual behavior. Most people express strong privacy preferences but continue to share personal data freely, accept default settings, and trade data for convenience.',
              },
              {
                id: 'q-ps-3',
                question: 'Which is the BEST first step in protecting your digital privacy?',
                options: [
                  'Deleting all your social media accounts immediately',
                  'Never using the internet again',
                  'Auditing your current privacy settings and understanding what data you are sharing',
                  'Only using one website',
                ],
                correctIndex: 2,
                explanation: 'A privacy audit — reviewing your settings, understanding what data you share, and making informed choices — is the most practical first step. It does not require extreme measures, just awareness and intentional decision-making about your digital footprint.',
              },
            ],
          },
          {
            id: 'ai-and-jobs',
            title: 'AI and Jobs',
            subtitle: 'How work is changing',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'The Automation Wave',
                content: 'AI is transforming the job market in complex ways. Some jobs are being automated entirely, but more often, specific tasks within jobs are being automated while other tasks remain human. Research suggests that rather than replacing whole occupations, AI will restructure most jobs — handling routine tasks while humans focus on creativity, judgment, and interpersonal skills.',
                bulletPoints: [
                  'Routine cognitive tasks (data entry, basic analysis) are most vulnerable',
                  'Creative, interpersonal, and judgment-heavy tasks are more resilient',
                  'New jobs are being created that did not exist five years ago',
                  'Most jobs will be transformed rather than eliminated entirely',
                ],
              },
              {
                type: 'explore',
                title: 'Jobs Created by AI',
                content: 'AI is also creating entirely new roles: prompt engineers, AI ethics officers, data annotators, AI trainers, machine learning operations engineers, and AI safety researchers. History shows that major technological shifts eliminate some jobs but create more new ones. The key is ensuring workers can transition to new roles through education and retraining.',
              },
              {
                type: 'challenge',
                title: 'Future-Proof Your Career',
                content: 'Research three career paths you are interested in. For each one, identify which tasks are likely to be automated by AI and which tasks will remain human. Then identify skills you can develop now that will remain valuable regardless of how AI evolves. Share your analysis with the group.',
              },
              {
                type: 'reflect',
                title: 'Whose Responsibility?',
                content: 'If AI makes companies more profitable but eliminates jobs, who should bear the cost of worker displacement? Should companies that automate jobs fund retraining programs? Should governments provide universal basic income? These are questions your generation will need to answer.',
              },
            ],
            quiz: [
              {
                id: 'q-aaj-1',
                question: 'How is AI most commonly affecting jobs?',
                options: [
                  'Eliminating all human jobs completely',
                  'Restructuring jobs by automating specific tasks while leaving others to humans',
                  'Having no effect on any jobs',
                  'Only affecting jobs in the tech industry',
                ],
                correctIndex: 1,
                explanation: 'Rather than replacing entire occupations, AI typically automates specific tasks within jobs. This restructures the role — routine tasks are handled by AI while humans focus on tasks requiring creativity, judgment, and interpersonal skills.',
              },
              {
                id: 'q-aaj-2',
                question: 'Which type of task is MOST resistant to AI automation?',
                options: [
                  'Data entry and filing',
                  'Basic calculations and reports',
                  'Creative problem-solving and interpersonal judgment',
                  'Following step-by-step instructions',
                ],
                correctIndex: 2,
                explanation: 'Tasks requiring creativity, complex judgment, emotional intelligence, and interpersonal skills are the most resistant to AI automation. These require uniquely human capabilities that current AI cannot replicate well.',
              },
              {
                id: 'q-aaj-3',
                question: 'What does history suggest about major technological shifts and employment?',
                options: [
                  'They always cause permanent mass unemployment',
                  'They eliminate some jobs but tend to create more new ones over time',
                  'They have no effect on employment',
                  'They only affect low-skilled workers',
                ],
                correctIndex: 1,
                explanation: 'Historical technological shifts (the printing press, the industrial revolution, the internet) eliminated certain types of jobs but created many new ones that did not previously exist. The challenge is managing the transition and ensuring workers can access new opportunities.',
              },
            ],
          },
          {
            id: 'ai-bill-of-rights',
            title: 'Your AI Bill of Rights',
            subtitle: 'What we should demand from AI systems',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Principles for AI Governance',
                content: 'The White House Blueprint for an AI Bill of Rights outlines five principles: safe and effective systems, protection from algorithmic discrimination, data privacy, notice and explanation (knowing when AI is being used and understanding its decisions), and human alternatives (the ability to opt out of AI and talk to a person). These principles provide a framework for demanding accountability from AI systems.',
                bulletPoints: [
                  'Safe and effective systems that are tested before deployment',
                  'Protection from algorithmic discrimination and bias',
                  'Data privacy and control over your personal information',
                  'Notice when AI is making decisions about you',
                  'The right to opt out and access human alternatives',
                ],
              },
              {
                type: 'explore',
                title: 'Global Approaches to AI Regulation',
                content: 'Different regions are taking different approaches to AI governance. The EU AI Act categorizes AI systems by risk level and bans certain uses like social scoring. China requires algorithmic transparency and user consent. The US has taken a more industry-led approach with voluntary commitments. Comparing these approaches reveals different values and priorities in AI governance.',
              },
              {
                type: 'challenge',
                title: 'Write Your Own AI Bill of Rights',
                content: 'Based on what you have learned, draft your own AI Bill of Rights with 5-7 principles. For each principle, write a brief explanation of why it matters and give a real-world example of what happens when this principle is violated. Present your bill of rights to the group for discussion and debate.',
              },
              {
                type: 'connect',
                title: 'Your Voice Matters',
                content: 'AI governance is not just for politicians and tech executives. Young people who grew up with AI have unique perspectives on how it should be regulated. Participate in public comment periods, join student advocacy groups, and speak up about AI policies at your school. The rules being written now will shape the world you live in for decades.',
              },
            ],
            quiz: [
              {
                id: 'q-abor-1',
                question: 'Which is NOT one of the five principles in the White House Blueprint for an AI Bill of Rights?',
                options: [
                  'Safe and effective systems',
                  'Protection from algorithmic discrimination',
                  'Guaranteed free access to all AI systems',
                  'Data privacy',
                ],
                correctIndex: 2,
                explanation: 'The five principles are: safe and effective systems, algorithmic discrimination protection, data privacy, notice and explanation, and human alternatives. Free access to AI is not one of the principles — the focus is on safety, fairness, and transparency.',
              },
              {
                id: 'q-abor-2',
                question: 'How does the EU AI Act approach AI regulation?',
                options: [
                  'It bans all AI systems entirely',
                  'It categorizes AI systems by risk level and bans certain high-risk uses',
                  'It only regulates AI used by governments',
                  'It lets companies self-regulate with no oversight',
                ],
                correctIndex: 1,
                explanation: 'The EU AI Act uses a risk-based approach: it categorizes AI applications by their potential for harm. Low-risk applications have minimal requirements, high-risk applications must meet strict standards, and certain uses (like social scoring) are banned entirely.',
              },
              {
                id: 'q-abor-3',
                question: 'What does "human alternatives" mean in the context of AI rights?',
                options: [
                  'Using human-like robots instead of AI software',
                  'The right to opt out of AI-based decisions and interact with a human instead',
                  'Teaching humans to think like AI',
                  'Replacing AI with human labor in all situations',
                ],
                correctIndex: 1,
                explanation: 'The "human alternatives" principle means that people should have the option to opt out of AI-driven processes and request human review or interaction instead. This is especially important for high-stakes decisions affecting healthcare, employment, or legal rights.',
              },
            ],
          },
        ],
      },
      // MODULE 7: AI-Native Workflow
      {
        id: 'ai-workflow',
        title: 'AI-Native Workflow',
        subtitle: 'Real-world productivity with AI',
        description: 'Learn to integrate AI tools into your daily work for research, data analysis, and professional documentation.',
        icon: 'workflow',
        color: '#22c55e',
        difficulty: 'advanced',
        ageRange: '15-18',
        badgeId: 'badge-ai-workflow',
        badgeName: 'Workflow Master',
        lessons: [
          {
            id: 'ai-augmented-research',
            title: 'AI-Augmented Research',
            subtitle: 'Supercharging how you find and synthesize information',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'Research in the AI Age',
                content: 'AI transforms research from a slow, linear process into a rapid, iterative one. AI can summarize long documents, identify key themes across hundreds of papers, suggest related sources, and help you synthesize findings. But the core of good research — asking the right questions, evaluating source credibility, and thinking critically about findings — remains a human skill.',
                bulletPoints: [
                  'Use AI to quickly survey a field and identify key papers',
                  'AI can summarize long documents but may miss nuances',
                  'Always verify AI-generated summaries against the original source',
                  'Use AI to identify connections and patterns across multiple sources',
                  'The research question and critical analysis are still your job',
                ],
              },
              {
                type: 'explore',
                title: 'AI Research Tools',
                content: 'Tools like Semantic Scholar, Elicit, and Consensus use AI to search academic literature and extract findings. Perplexity and similar AI search engines provide sourced answers to research questions. Large language models can help you understand complex papers, generate literature reviews, and identify gaps in existing research. Each tool has strengths and limitations.',
              },
              {
                type: 'challenge',
                title: 'AI-Assisted Literature Review',
                content: 'Choose a topic you need to research for school. Use at least three different AI tools to gather information. Compare their results: where do they agree? Where do they disagree? Which provided the most reliable sources? Write a one-page synthesis that includes at least five verified sources.',
              },
              {
                type: 'reflect',
                title: 'The Researcher\'s Edge',
                content: 'The students who will excel are not those who use AI to avoid the hard work of research, but those who use AI to do deeper, more thorough research than was previously possible. AI handles the tedious parts — skimming hundreds of articles, extracting data points — so you can focus on the intellectually demanding parts: analysis, synthesis, and original thinking.',
              },
            ],
            quiz: [
              {
                id: 'q-aar-1',
                question: 'What should you ALWAYS do after AI summarizes a research paper?',
                options: [
                  'Immediately cite it in your own paper',
                  'Verify the summary against the original source',
                  'Share it on social media',
                  'Assume it is perfectly accurate',
                ],
                correctIndex: 1,
                explanation: 'AI summaries can miss nuances, misinterpret findings, or introduce errors. Always check AI-generated summaries against the original source to ensure accuracy, especially for important claims or specific details you plan to cite.',
              },
              {
                id: 'q-aar-2',
                question: 'Which part of the research process remains primarily a human skill?',
                options: [
                  'Searching for sources',
                  'Summarizing articles',
                  'Asking the right questions and critically evaluating findings',
                  'Formatting citations',
                ],
                correctIndex: 2,
                explanation: 'While AI can handle searching, summarizing, and formatting, the core intellectual work — formulating good research questions, evaluating the credibility and significance of findings, and synthesizing ideas into original insights — remains fundamentally human.',
              },
              {
                id: 'q-aar-3',
                question: 'What is the best way to use AI for research?',
                options: [
                  'Copy AI-generated text directly into your assignments',
                  'Use AI to handle tedious tasks so you can focus on analysis and original thinking',
                  'Only use AI if you cannot find information any other way',
                  'Let AI write your entire research paper',
                ],
                correctIndex: 1,
                explanation: 'The optimal approach is using AI to accelerate the mechanical parts of research — surveying literature, extracting data, identifying patterns — while you invest your time in the higher-order tasks: critical analysis, synthesis, and developing original arguments.',
              },
            ],
          },
          {
            id: 'ai-data-analysis',
            title: 'AI for Data Analysis',
            subtitle: 'Making sense of numbers with AI',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'AI-Powered Data Analysis',
                content: 'AI can transform how you work with data. Instead of learning complex statistical software, you can describe what you want in natural language. AI tools can clean messy data, generate visualizations, run statistical tests, and explain results in plain language. This democratizes data analysis, making it accessible to people without programming expertise.',
                bulletPoints: [
                  'Natural language queries: "Show me the trend in sales over the last 12 months"',
                  'Automated data cleaning: handling missing values and formatting issues',
                  'Smart visualizations: AI suggests the best chart type for your data',
                  'Statistical analysis: AI runs appropriate tests and explains results',
                  'Pattern detection: finding trends and outliers humans might miss',
                ],
              },
              {
                type: 'explore',
                title: 'Tools for AI Data Analysis',
                content: 'ChatGPT and Claude can analyze data when you upload CSV files or describe datasets. Specialized tools like Julius AI and Rows AI are built specifically for data analysis. Python with libraries like Pandas and Matplotlib remains the gold standard for complex analysis. The best approach often combines AI tools with traditional methods.',
              },
              {
                type: 'challenge',
                title: 'Analyze Real Data',
                content: 'Find a public dataset that interests you (try data.gov, Kaggle, or Our World in Data). Upload it to an AI tool and ask it to identify the three most interesting patterns. Then verify those patterns yourself using a different method. Create a visualization that tells a compelling story with the data.',
              },
              {
                type: 'reflect',
                title: 'Data Literacy Still Matters',
                content: 'AI makes data analysis easier, but understanding what the numbers mean is still your responsibility. You need to know when a correlation is not causation, when a sample size is too small, and when a visualization is misleading. AI is a power tool — it amplifies both good analysis and bad analysis.',
              },
            ],
            quiz: [
              {
                id: 'q-ada-1',
                question: 'How has AI changed data analysis?',
                options: [
                  'It has made data analysis completely automatic with no human input needed',
                  'It allows natural language queries and makes analysis accessible to non-programmers',
                  'It has replaced all traditional statistical methods',
                  'It has made data analysis slower but more accurate',
                ],
                correctIndex: 1,
                explanation: 'AI has made data analysis more accessible by allowing people to describe what they want in natural language instead of writing code. However, human judgment is still needed to interpret results, check for errors, and ensure the analysis is meaningful.',
              },
              {
                id: 'q-ada-2',
                question: 'Why is data literacy still important even with AI tools?',
                options: [
                  'Because AI tools are too expensive for most people',
                  'Because you need to understand what numbers mean, spot misleading patterns, and verify AI\'s analysis',
                  'Because AI cannot process numbers',
                  'Because data literacy is required by law',
                ],
                correctIndex: 1,
                explanation: 'AI can crunch numbers efficiently, but understanding whether the analysis is meaningful — distinguishing correlation from causation, recognizing insufficient sample sizes, spotting misleading visualizations — requires human data literacy. AI amplifies both good and bad analysis.',
              },
              {
                id: 'q-ada-3',
                question: 'What is the recommended approach for AI-powered data analysis?',
                options: [
                  'Only use AI tools and never look at the raw data',
                  'Combine AI tools with traditional methods and always verify key findings',
                  'Avoid AI tools entirely and only use manual analysis',
                  'Use as many AI tools as possible on the same data simultaneously',
                ],
                correctIndex: 1,
                explanation: 'The best approach combines the speed and accessibility of AI tools with the rigor of traditional methods. Use AI for initial exploration and pattern detection, then verify important findings using independent methods to ensure accuracy.',
              },
            ],
          },
          {
            id: 'process-document',
            title: 'The Process Document',
            subtitle: 'Documenting your AI-augmented workflow',
            xpReward: 100,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Why Document Your Process?',
                content: 'In a world where AI can generate polished final products, the process behind the product becomes more important than ever. A process document records how you used AI tools, what prompts you tried, which results you accepted or rejected, and what original thinking you contributed. It demonstrates genuine understanding and provides transparency about AI involvement.',
                bulletPoints: [
                  'Shows your thinking process, not just the final output',
                  'Documents which AI tools you used and how',
                  'Records prompts, iterations, and decision-making',
                  'Demonstrates original analysis and critical thinking',
                  'Provides accountability and transparency',
                ],
              },
              {
                type: 'explore',
                title: 'What to Include',
                content: 'A good process document includes: your original research question, the AI tools you used and why, key prompts and the reasoning behind them, how you evaluated and modified AI outputs, what you fact-checked and verified, your original analysis and conclusions, and reflections on what worked and what did not. Think of it as a lab notebook for knowledge work.',
              },
              {
                type: 'challenge',
                title: 'Create Your Process Document',
                content: 'For your next school assignment, maintain a detailed process document alongside your final submission. Record every interaction with AI tools, including prompts, outputs, and your evaluation of each output. Note where you added original thinking. Submit both the assignment and the process document.',
              },
              {
                type: 'connect',
                title: 'The Future of Work Documentation',
                content: 'Many companies and schools are adopting process documentation as a standard practice. It is becoming as important to show how you arrived at an answer as to show the answer itself. Students who master this skill now will have a significant advantage in colleges and workplaces that value transparency and critical thinking.',
              },
            ],
            quiz: [
              {
                id: 'q-pd-1',
                question: 'Why are process documents becoming more important in the AI age?',
                options: [
                  'Because AI cannot produce final documents',
                  'Because when AI can generate polished outputs, the process shows genuine understanding and original thinking',
                  'Because process documents are legally required',
                  'Because they make assignments longer',
                ],
                correctIndex: 1,
                explanation: 'When AI can produce professional-quality outputs, the final product alone does not demonstrate your understanding. A process document shows your thinking, decision-making, and original contributions — proving that you engaged deeply with the material rather than just generating an output.',
              },
              {
                id: 'q-pd-2',
                question: 'What should a process document include?',
                options: [
                  'Only the final polished output',
                  'AI tools used, prompts tried, evaluations made, and original thinking contributed',
                  'A list of every website you visited',
                  'Only the parts where AI made mistakes',
                ],
                correctIndex: 1,
                explanation: 'A comprehensive process document records the full journey: which AI tools you used, your prompts and reasoning, how you evaluated outputs, what you verified, and where you contributed original analysis. It is a complete record of your thinking process.',
              },
              {
                id: 'q-pd-3',
                question: 'What is a good analogy for a process document?',
                options: [
                  'A photo album',
                  'A lab notebook for knowledge work',
                  'A grocery list',
                  'A social media post',
                ],
                correctIndex: 1,
                explanation: 'Like a lab notebook that records experimental procedures, observations, and analysis, a process document records your intellectual workflow — your questions, methods, AI interactions, evaluations, and conclusions. Both provide transparency and reproducibility.',
              },
            ],
          },
        ],
      },
      // MODULE 8: The AI Frontier
      {
        id: 'ai-frontier',
        title: 'The AI Frontier',
        subtitle: 'What\'s next',
        description: 'Explore cutting-edge AI developments including multimodal systems, agentic AI, scientific applications, and careers of the future.',
        icon: 'rocket',
        color: '#22c55e',
        difficulty: 'advanced',
        ageRange: '16-18',
        badgeId: 'badge-ai-frontier',
        badgeName: 'Frontier Scout',
        lessons: [
          {
            id: 'multimodal-agentic',
            title: 'Multimodal & Agentic AI',
            subtitle: 'AI that sees, hears, and acts',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'Multimodal AI',
                content: 'Multimodal AI systems can process and generate multiple types of data — text, images, audio, video, and code — within a single model. Unlike earlier AI systems that handled only one type of input, multimodal models can look at a photo and describe it, listen to audio and transcribe it, or generate a video from a text description. This mirrors how humans naturally integrate multiple senses to understand the world.',
                bulletPoints: [
                  'Can process text, images, audio, and video together',
                  'Understands relationships between different types of data',
                  'Examples: GPT-4V, Gemini, Claude with vision capabilities',
                  'Enables new applications like visual question answering and video understanding',
                ],
              },
              {
                type: 'learn',
                title: 'Agentic AI',
                content: 'Agentic AI refers to systems that can autonomously plan, use tools, and take actions to accomplish complex goals. Instead of just answering questions, an AI agent might research a topic using web search, analyze data in a spreadsheet, write a report, and email it to stakeholders — all from a single high-level instruction. This represents a shift from AI as a tool to AI as a collaborator.',
                bulletPoints: [
                  'Plans multi-step workflows to achieve complex goals',
                  'Uses external tools like web browsers, code interpreters, and APIs',
                  'Makes decisions about which steps to take next',
                  'Can recover from errors and adapt plans',
                ],
              },
              {
                type: 'explore',
                title: 'The Current State',
                content: 'As of 2025-2026, agentic AI is rapidly advancing but still has significant limitations. Agents can make errors that compound across steps, they can struggle with ambiguous instructions, and they need careful guardrails to prevent unintended actions. The most effective approach is human-AI collaboration, where the agent handles routine steps and checks in with humans at critical decision points.',
              },
              {
                type: 'reflect',
                title: 'Implications of AI Agents',
                content: 'If AI can autonomously complete complex workflows, what does that mean for how we work, learn, and create? Will human oversight keep pace with AI autonomy? How do we maintain accountability when an AI agent makes a mistake across a chain of automated decisions? These are questions without settled answers.',
              },
            ],
            quiz: [
              {
                id: 'q-ma-1',
                question: 'What makes AI "multimodal"?',
                options: [
                  'It can run on multiple devices simultaneously',
                  'It can process and generate multiple types of data (text, images, audio) in a single model',
                  'It uses multiple internet connections',
                  'It can speak multiple languages',
                ],
                correctIndex: 1,
                explanation: 'Multimodal AI can handle multiple types of data — text, images, audio, video — within one unified model. This allows it to understand relationships between different data types, like describing what is happening in a photo or generating images from text.',
              },
              {
                id: 'q-ma-2',
                question: 'What distinguishes agentic AI from traditional AI assistants?',
                options: [
                  'Agentic AI is always more accurate',
                  'Agentic AI can autonomously plan, use tools, and take multi-step actions to achieve goals',
                  'Agentic AI works without electricity',
                  'Agentic AI only responds to voice commands',
                ],
                correctIndex: 1,
                explanation: 'Agentic AI goes beyond answering individual questions. It can independently plan multi-step workflows, use external tools (web search, code execution, APIs), make decisions about next steps, and execute complex tasks with minimal human guidance.',
              },
              {
                id: 'q-ma-3',
                question: 'What is the recommended approach for using agentic AI in 2025-2026?',
                options: [
                  'Let AI agents work completely independently',
                  'Never use AI agents because they make mistakes',
                  'Human-AI collaboration where agents handle routine steps and check in with humans at critical points',
                  'Only use AI agents for entertainment',
                ],
                correctIndex: 2,
                explanation: 'The most effective current approach is human-AI collaboration. AI agents handle routine and repetitive steps efficiently, while humans provide oversight at critical decision points. This balances the efficiency of automation with the judgment and accountability of human involvement.',
              },
            ],
          },
          {
            id: 'ai-in-science',
            title: 'AI in Science',
            subtitle: 'Accelerating discovery',
            xpReward: 100,
            durationMinutes: 22,
            sections: [
              {
                type: 'learn',
                title: 'AI as a Scientific Tool',
                content: 'AI is revolutionizing scientific research by solving problems that were previously intractable. AlphaFold predicted the 3D structure of nearly every known protein, a problem that had stumped biologists for 50 years. AI is discovering new materials, designing drugs, modeling climate change, and even finding new mathematical theorems. It does not replace scientists but dramatically accelerates their work.',
                bulletPoints: [
                  'AlphaFold: predicted 200+ million protein structures',
                  'Drug discovery: AI screens billions of molecular compounds in days',
                  'Climate science: AI improves weather prediction and climate models',
                  'Materials science: AI designs new materials with specific properties',
                  'Mathematics: AI has discovered new mathematical conjectures',
                ],
              },
              {
                type: 'explore',
                title: 'How AI Accelerates Research',
                content: 'AI accelerates science in several ways: it can process and find patterns in datasets too large for humans to analyze, it can run millions of simulated experiments in the time it takes to run one real experiment, and it can identify promising research directions by analyzing the entire body of scientific literature. The result is a dramatic compression of the discovery timeline.',
              },
              {
                type: 'challenge',
                title: 'Design an AI Experiment',
                content: 'Choose a scientific field that interests you. Research one way AI is being used in that field. Then propose an original idea for how AI could help solve an unsolved problem in that field. Write a one-page proposal describing the problem, your proposed AI approach, what data would be needed, and what success would look like.',
              },
              {
                type: 'connect',
                title: 'The Future Scientist',
                content: 'The scientists of tomorrow will be those who can combine deep domain knowledge with AI fluency. Biologists who can use AlphaFold, chemists who can design AI-driven experiments, and physicists who can train neural networks on simulation data will have massive advantages. Learning AI now, alongside your scientific interests, positions you at this powerful intersection.',
              },
            ],
            quiz: [
              {
                id: 'q-ais-1',
                question: 'What did AlphaFold accomplish?',
                options: [
                  'It won a chess tournament against a grandmaster',
                  'It predicted the 3D structure of nearly every known protein',
                  'It discovered a new planet in our solar system',
                  'It wrote a complete biology textbook',
                ],
                correctIndex: 1,
                explanation: 'AlphaFold, developed by DeepMind, predicted the three-dimensional structures of over 200 million proteins. Protein structure prediction had been one of biology\'s grand challenges for 50 years, and AlphaFold\'s solution is accelerating research in drug discovery, disease understanding, and more.',
              },
              {
                id: 'q-ais-2',
                question: 'How does AI primarily accelerate scientific discovery?',
                options: [
                  'By replacing scientists entirely',
                  'By processing huge datasets, running simulated experiments, and finding patterns humans would miss',
                  'By writing grant proposals faster',
                  'By making laboratory equipment cheaper',
                ],
                correctIndex: 1,
                explanation: 'AI accelerates science by handling tasks that are impossible or impractical for humans: analyzing massive datasets, running millions of simulations rapidly, and identifying patterns across the entire body of scientific literature. It augments human scientists rather than replacing them.',
              },
              {
                id: 'q-ais-3',
                question: 'What combination of skills will be most valuable for future scientists?',
                options: [
                  'Deep domain knowledge combined with AI fluency',
                  'Only AI programming skills',
                  'Only traditional laboratory skills',
                  'Business management and marketing',
                ],
                correctIndex: 0,
                explanation: 'Future scientists will be most effective when they combine deep expertise in their scientific domain with the ability to leverage AI tools. Neither skill alone is sufficient — you need domain knowledge to ask the right questions and AI fluency to harness computational power.',
              },
            ],
          },
          {
            id: 'future-careers',
            title: 'Careers That Don\'t Exist Yet',
            subtitle: 'Preparing for jobs of tomorrow',
            xpReward: 100,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Emerging Career Categories',
                content: 'Many jobs that will exist in 10 years have not been invented yet. Based on current trends, emerging career areas include AI safety and alignment research, human-AI interaction design, synthetic media forensics, AI-augmented healthcare, personalized education design, and autonomous systems management. The common thread is that these roles combine technical AI skills with deep human understanding.',
                bulletPoints: [
                  'AI Safety Engineer: ensuring AI systems behave as intended',
                  'Synthetic Media Forensics Expert: detecting deepfakes and AI-generated content',
                  'Human-AI Collaboration Designer: creating effective human-AI workflows',
                  'AI Ethics Auditor: evaluating AI systems for bias and fairness',
                  'Personalized Learning Architect: designing AI-driven education experiences',
                ],
              },
              {
                type: 'explore',
                title: 'Skills That Transfer',
                content: 'While specific jobs change, foundational skills endure. Critical thinking, clear communication, creativity, emotional intelligence, systems thinking, and technical literacy will remain valuable regardless of what specific jobs emerge. The most adaptable professionals will be those with a strong foundation in these transferable skills plus the ability to quickly learn new tools and domains.',
              },
              {
                type: 'challenge',
                title: 'Invent a Career',
                content: 'Based on everything you have learned in this track, invent a career that does not exist yet but probably should. Give it a name, write a job description, list required skills, and explain why the world needs this role. Be creative but grounded in real trends and real problems that need solving.',
              },
              {
                type: 'reflect',
                title: 'Your Competitive Advantage',
                content: 'You are learning about AI at an age when your brain is highly adaptable and your career is still forming. This gives you a massive advantage over adults who are trying to adapt to AI later in their careers. The combination of growing up with AI and deliberately studying it positions you to be a leader in whatever field you choose.',
              },
            ],
            quiz: [
              {
                id: 'q-fc-1',
                question: 'What do most emerging AI-era careers have in common?',
                options: [
                  'They all require a PhD in computer science',
                  'They combine technical AI skills with deep human understanding',
                  'They all involve building robots',
                  'They are only available in Silicon Valley',
                ],
                correctIndex: 1,
                explanation: 'Emerging AI-era careers share a common pattern: they combine technical understanding of AI with uniquely human skills like ethics, creativity, empathy, and domain expertise. Pure technical skill or pure human skill alone is less valuable than the combination.',
              },
              {
                id: 'q-fc-2',
                question: 'Which skill is MOST likely to remain valuable regardless of how AI evolves?',
                options: [
                  'Memorizing large amounts of information',
                  'Operating specific software versions',
                  'Critical thinking and adaptability',
                  'Typing speed',
                ],
                correctIndex: 2,
                explanation: 'Critical thinking and adaptability are meta-skills that apply to any domain and any tool. While specific software knowledge becomes obsolete, the ability to think clearly, evaluate information, and adapt to new tools and situations remains universally valuable.',
              },
              {
                id: 'q-fc-3',
                question: 'Why is studying AI at a young age a competitive advantage?',
                options: [
                  'Because AI is easier for young people to understand',
                  'Because your brain is highly adaptable and your career path is still forming',
                  'Because there is an age limit for working with AI',
                  'Because schools give extra credit for AI knowledge',
                ],
                correctIndex: 1,
                explanation: 'Young people have the advantage of neuroplasticity (adaptable brains that absorb new concepts readily) and career flexibility (the ability to build career plans around AI from the start). Adults often have to retrofit AI knowledge into established career paths.',
              },
            ],
          },
        ],
      },
    ],
  },
  // =====================================================================
  // TRACK 2: MATH FOR AI ERA
  // =====================================================================
  {
    id: 'math',
    title: 'Math for AI Era',
    subtitle: 'The mathematical foundations powering AI',
    description: 'From data literacy to calculus, discover how math is the language behind every AI system and learn to speak it fluently.',
    icon: 'FN',
    color: '#6366f1',
    modules: [
      // MODULE 1: Data Literacy
      {
        id: 'data-literacy',
        title: 'Data Literacy',
        subtitle: 'Numbers tell stories',
        description: 'Learn to read, interpret, and question data. Understand the types of data, basic statistics, and how visualizations can both reveal and conceal the truth.',
        icon: 'bar-chart',
        color: '#6366f1',
        difficulty: 'beginner',
        ageRange: '10-12',
        badgeId: 'badge-data-literacy',
        badgeName: 'Data Reader',
        lessons: [
          {
            id: 'types-of-data',
            title: 'Types of Data',
            subtitle: 'Not all data is created equal',
            xpReward: 50,
            durationMinutes: 10,
            sections: [
              {
                type: 'learn',
                title: 'Categorical vs Numerical',
                content: 'Data comes in two major flavors: categorical and numerical. Categorical data represents groups or labels — like favorite color, country of birth, or genre of music. Numerical data represents measurable quantities — like height, temperature, or test scores. Knowing the difference determines which math operations and visualizations make sense for your data.',
                bulletPoints: [
                  'Categorical (nominal): labels with no order — colors, names, yes/no',
                  'Categorical (ordinal): labels with a natural order — small/medium/large, ratings',
                  'Numerical (discrete): countable whole numbers — number of siblings, goals scored',
                  'Numerical (continuous): measurable values — height, weight, temperature',
                ],
              },
              {
                type: 'explore',
                title: 'Data All Around You',
                content: 'Think about the data you encounter daily. Your age is discrete numerical data. Your favorite food is categorical data. Your exact height is continuous numerical data. A movie rating (1 to 5 stars) is ordinal data. Recognizing data types in the wild is the first step toward analyzing them properly.',
              },
              {
                type: 'challenge',
                title: 'Data Collection Activity',
                content: 'Survey ten friends or family members with five questions that each collect a different type of data: one nominal, one ordinal, one discrete, one continuous, and one yes/no. Organize your results in a table and label each column with its data type. Notice which types are easiest and hardest to collect accurately.',
              },
              {
                type: 'reflect',
                title: 'Why Data Types Matter',
                content: 'Using the wrong analysis for a data type leads to nonsense results. You cannot calculate the "average" favorite color. You should not use a pie chart for continuous data. AI systems need to handle different data types differently too — this is why data preprocessing is such an important step in machine learning.',
              },
            ],
            quiz: [
              {
                id: 'q-tod-1',
                question: 'Which of the following is an example of categorical (nominal) data?',
                options: [
                  'A person\'s height in centimeters',
                  'The number of books someone has read',
                  'A person\'s favorite sport',
                  'The temperature outside in degrees',
                ],
                correctIndex: 2,
                explanation: 'A favorite sport is a category label — there is no numerical value or natural ordering to sports preferences. It is nominal categorical data because the categories (basketball, soccer, tennis) have no inherent rank or order.',
              },
              {
                id: 'q-tod-2',
                question: 'What makes data "ordinal" rather than just "categorical"?',
                options: [
                  'It has more categories',
                  'The categories have a natural, meaningful order',
                  'It uses numbers instead of words',
                  'It was collected in chronological order',
                ],
                correctIndex: 1,
                explanation: 'Ordinal data has categories with a meaningful order or ranking. For example, satisfaction ratings (very unhappy, unhappy, neutral, happy, very happy) have a clear sequence. Regular categorical data like colors or names have no such natural ordering.',
              },
              {
                id: 'q-tod-3',
                question: 'Why can\'t you calculate the "average" of categorical data like favorite colors?',
                options: [
                  'Because colors are too complex for math',
                  'Because categorical labels are not numbers, so arithmetic operations like averaging do not apply',
                  'Because you need at least 1000 data points to average colors',
                  'You actually can average colors — the question is wrong',
                ],
                correctIndex: 1,
                explanation: 'Averaging requires numerical values that can be added and divided. Categorical labels like "blue" and "red" are not numbers — there is no meaningful way to add them or divide by a count. For categorical data, you use the mode (most frequent category) instead.',
              },
            ],
          },
          {
            id: 'mean-median-mode',
            title: 'Mean Median Mode',
            subtitle: 'Three ways to find the center',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Measures of Central Tendency',
                content: 'Mean, median, and mode are three ways to describe the "center" or "typical value" of a dataset. The mean is the arithmetic average — add all values and divide by the count. The median is the middle value when data is sorted. The mode is the most frequently occurring value. Each tells a different story about your data, and choosing the right one matters.',
                bulletPoints: [
                  'Mean: sum of all values divided by count (sensitive to outliers)',
                  'Median: the middle value when sorted (resistant to outliers)',
                  'Mode: the most common value (works for any data type)',
                  'For symmetric data, mean and median are similar',
                  'For skewed data, median is often more representative',
                ],
              },
              {
                type: 'explore',
                title: 'When Each Measure Shines',
                content: 'Imagine a neighborhood where nine houses are worth $200,000 and one mansion is worth $5,000,000. The mean home price is $680,000, but the median is $200,000. The median better represents the typical home. This is why income statistics usually report median rather than mean — a few billionaires can dramatically skew the average while the median stays grounded in reality.',
              },
              {
                type: 'challenge',
                title: 'Calculate All Three',
                content: 'Collect the ages of 15 people (use friends, family, or make reasonable estimates). Calculate the mean, median, and mode. Now add one very old person (say, 100 years old) to your dataset. Recalculate all three. Which measure changed the most? Which changed the least? This demonstrates the concept of robustness to outliers.',
              },
              {
                type: 'reflect',
                title: 'Choosing Wisely',
                content: 'When someone reports an "average," always ask which average they mean. A company might report mean salary to make it look higher (if executives earn a lot) or median salary to make it look more typical. Understanding these measures helps you see through statistical spin and make better decisions based on data.',
              },
            ],
            quiz: [
              {
                id: 'q-mmm-1',
                question: 'In the dataset [2, 3, 3, 7, 100], which measure of central tendency best represents the typical value?',
                options: [
                  'Mean (23)',
                  'Median (3)',
                  'Mode (3)',
                  'Both median and mode (3)',
                ],
                correctIndex: 3,
                explanation: 'The value 100 is an extreme outlier that inflates the mean to 23. Both the median (3, the middle value) and the mode (3, the most frequent value) better represent the typical value in this dataset, which clusters around 2-7.',
              },
              {
                id: 'q-mmm-2',
                question: 'Why do economists usually report MEDIAN household income rather than MEAN?',
                options: [
                  'Because the median is always a larger number',
                  'Because the mean is too hard to calculate for large populations',
                  'Because a small number of very high incomes can skew the mean upward, making it unrepresentative',
                  'Because the government requires the median by law',
                ],
                correctIndex: 2,
                explanation: 'Income distributions are heavily right-skewed — a small number of people earn vastly more than the majority. These extreme values pull the mean upward, making it unrepresentative of typical income. The median is resistant to these outliers and better represents what a typical household earns.',
              },
              {
                id: 'q-mmm-3',
                question: 'Which measure of central tendency can be used with categorical data?',
                options: [
                  'Mean',
                  'Median',
                  'Mode',
                  'All three equally',
                ],
                correctIndex: 2,
                explanation: 'The mode (most frequent value) is the only measure of central tendency that works for categorical data. You can find the most common favorite color or most popular genre. Mean and median require numerical values that can be ordered and calculated.',
              },
            ],
          },
          {
            id: 'data-visualization',
            title: 'Data Visualization',
            subtitle: 'Making numbers visual',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Choosing the Right Chart',
                content: 'Different data types and questions demand different visualizations. Bar charts compare categories. Line charts show trends over time. Scatter plots reveal relationships between two variables. Pie charts show parts of a whole (but are often overused). Histograms show the distribution of numerical data. Choosing the wrong chart type can confuse or mislead your audience.',
                bulletPoints: [
                  'Bar charts: comparing quantities across categories',
                  'Line charts: showing trends and changes over time',
                  'Scatter plots: exploring relationships between two numerical variables',
                  'Pie charts: showing proportions of a whole (use sparingly)',
                  'Histograms: showing the distribution shape of numerical data',
                ],
              },
              {
                type: 'explore',
                title: 'The Power of Visual Perception',
                content: 'Humans process visual information far faster than numbers in a table. A well-designed chart can reveal patterns, trends, and outliers in seconds that would take minutes to spot in raw data. This is why data visualization is one of the most important skills in data science — and why AI tools that auto-generate visualizations are so valuable.',
              },
              {
                type: 'challenge',
                title: 'Tell a Story with Data',
                content: 'Find a dataset about something you care about (sports statistics, climate data, video game sales). Create three different visualizations that each tell a different story from the same data. Write a sentence under each chart explaining what insight it reveals. Notice how the choice of chart changes the narrative.',
              },
              {
                type: 'reflect',
                title: 'Visualization Ethics',
                content: 'Visualizations can be used to mislead, even without lying. Truncating the y-axis can make small differences look dramatic. Cherry-picking time ranges can hide important trends. Using 3D effects can distort proportions. Being a critical consumer of data visualizations is just as important as being a good creator of them.',
              },
            ],
            quiz: [
              {
                id: 'q-dv-1',
                question: 'Which chart type is best for showing how a value changes over time?',
                options: [
                  'Pie chart',
                  'Line chart',
                  'Bar chart',
                  'Scatter plot',
                ],
                correctIndex: 1,
                explanation: 'Line charts excel at showing trends over time because the connected line makes it easy to see the direction and rate of change. The x-axis typically represents time, and the continuous line reveals patterns like growth, decline, or cycles.',
              },
              {
                id: 'q-dv-2',
                question: 'How can a chart be misleading without containing any false data?',
                options: [
                  'It is impossible — if the data is true, the chart is honest',
                  'By manipulating visual elements like truncated axes, cherry-picked ranges, or distorted proportions',
                  'By using too many colors',
                  'By making the chart too large',
                ],
                correctIndex: 1,
                explanation: 'Charts can mislead through visual manipulation: truncating the y-axis exaggerates differences, cherry-picking time ranges hides context, 3D effects distort proportions, and inconsistent scales make comparisons unfair. The data can be completely accurate while the visual presentation creates a false impression.',
              },
              {
                id: 'q-dv-3',
                question: 'Which chart type is best for exploring whether two numerical variables are related?',
                options: [
                  'Pie chart',
                  'Bar chart',
                  'Scatter plot',
                  'Histogram',
                ],
                correctIndex: 2,
                explanation: 'Scatter plots place one variable on each axis and plot individual data points. This reveals whether the variables are correlated (points form a pattern), uncorrelated (points are randomly scattered), or have a non-linear relationship (points form a curve).',
              },
            ],
          },
          {
            id: 'misleading-statistics',
            title: 'Misleading Statistics',
            subtitle: 'Lies, damned lies, and numbers',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Common Statistical Tricks',
                content: 'Statistics can be manipulated to support almost any narrative. Common tricks include cherry-picking favorable time periods, using misleading averages, conflating correlation with causation, presenting relative numbers without absolute context, and using biased samples. Recognizing these tricks is essential for consuming news, research, and marketing claims critically.',
                bulletPoints: [
                  'Cherry-picking: choosing data ranges that support your argument',
                  'Misleading averages: using mean instead of median (or vice versa) to distort',
                  'Correlation vs causation: just because two things correlate does not mean one causes the other',
                  'Relative vs absolute: "50% increase" sounds dramatic but might mean going from 2 to 3',
                  'Biased samples: surveying only people who agree with you',
                ],
              },
              {
                type: 'explore',
                title: 'Correlation Is Not Causation',
                content: 'This is perhaps the most important statistical concept to understand. Ice cream sales and drowning deaths both increase in summer — they are correlated but neither causes the other (warm weather causes both). Websites like "Spurious Correlations" show absurd examples: the divorce rate in Maine correlates with per-capita margarine consumption. Always ask: is there a plausible causal mechanism, or is this coincidence?',
              },
              {
                type: 'challenge',
                title: 'Spot the Spin',
                content: 'Find three statistical claims in news articles, advertisements, or social media posts. For each one, identify: What exactly is being claimed? What data supports it? What might be left out? Is there a possible alternative explanation? Write a paragraph evaluating whether each claim is well-supported or misleading.',
              },
              {
                type: 'reflect',
                title: 'Statistical Self-Defense',
                content: 'You do not need to be a statistician to defend yourself against misleading statistics. Just asking basic questions — What is the sample size? Who collected this data? What is the absolute number behind that percentage? Could there be another explanation? — puts you ahead of most people in critically evaluating quantitative claims.',
              },
            ],
            quiz: [
              {
                id: 'q-ms-1',
                question: 'If a study finds that people who eat breakfast earn higher salaries, what can we conclude?',
                options: [
                  'Eating breakfast causes higher salaries',
                  'Higher salaries cause people to eat breakfast',
                  'There is a correlation, but we cannot determine causation without more evidence',
                  'The study must be wrong',
                ],
                correctIndex: 2,
                explanation: 'Correlation does not prove causation. While breakfast and salary are correlated, many other factors could explain both — perhaps wealthier people have more time for breakfast, or both habits correlate with a third factor like general health consciousness. Determining causation requires controlled experiments.',
              },
              {
                id: 'q-ms-2',
                question: '"Our product reduces risk by 50%!" If the actual risk went from 2 in 10,000 to 1 in 10,000, why is this claim misleading?',
                options: [
                  'Because 50% is not a real number',
                  'Because the absolute risk reduction is tiny (0.01%) even though the relative reduction sounds dramatic',
                  'Because the math is wrong — it should be 100%',
                  'Because you cannot reduce risk with products',
                ],
                correctIndex: 1,
                explanation: 'The relative risk reduction (50%) sounds impressive, but the absolute numbers tell a different story: the risk went from 0.02% to 0.01%, a reduction of just 0.01 percentage points. Presenting only relative numbers without absolute context is a common way to make small effects sound dramatic.',
              },
              {
                id: 'q-ms-3',
                question: 'What is "cherry-picking" in statistics?',
                options: [
                  'Collecting data from fruit orchards',
                  'Selecting only the data or time periods that support your desired conclusion while ignoring the rest',
                  'Using the best available data sources',
                  'Randomly selecting data points for analysis',
                ],
                correctIndex: 1,
                explanation: 'Cherry-picking means selectively presenting data that supports your argument while omitting data that contradicts it. For example, showing a stock\'s performance only during its best quarter rather than the full year creates a misleading picture of its true performance.',
              },
            ],
          },
        ],
      },
      // MODULE 2: Probability & Prediction
      {
        id: 'probability',
        title: 'Probability & Prediction',
        subtitle: 'What are the chances?',
        description: 'Understand the mathematics of uncertainty — from basic probability to Bayes\' Theorem — and learn how AI uses probability to make predictions.',
        icon: 'dice',
        color: '#6366f1',
        difficulty: 'beginner',
        ageRange: '12-14',
        badgeId: 'badge-probability',
        badgeName: 'Probability Pro',
        lessons: [
          {
            id: 'basic-probability',
            title: 'Basic Probability',
            subtitle: 'The math of uncertainty',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'What Is Probability?',
                content: 'Probability measures how likely an event is to occur, expressed as a number between 0 (impossible) and 1 (certain). A fair coin has a 0.5 probability of landing heads. A standard die has a 1/6 probability of showing any specific number. Probability is the mathematical language of uncertainty, and it is at the heart of how AI systems make decisions under uncertainty.',
                bulletPoints: [
                  'Probability ranges from 0 (impossible) to 1 (certain)',
                  'P(event) = favorable outcomes / total possible outcomes',
                  'Complementary: P(not A) = 1 - P(A)',
                  'Independent events: one outcome does not affect another',
                  'Dependent events: one outcome changes the probability of another',
                ],
              },
              {
                type: 'explore',
                title: 'Probability in Everyday Life',
                content: 'You use probability thinking constantly without realizing it. Checking weather forecasts ("70% chance of rain"), evaluating risks ("what are the odds I get caught?"), and making decisions under uncertainty ("should I study more or is this enough?") all involve informal probability reasoning. Making this reasoning formal and mathematical gives you a powerful thinking tool.',
              },
              {
                type: 'challenge',
                title: 'Probability Experiment',
                content: 'Flip a coin 50 times and record each result. Calculate the running proportion of heads after every 10 flips. Plot these proportions on a graph. You should see the proportion converge toward 0.5 as you flip more. This demonstrates the Law of Large Numbers — with enough trials, observed frequency approaches theoretical probability.',
              },
              {
                type: 'reflect',
                title: 'Probability and AI',
                content: 'Every AI prediction is fundamentally a probability statement. When a spam filter says an email is "95% likely spam," it is expressing a probability. When a language model generates the next word, it is choosing from a probability distribution over all possible words. Understanding probability is understanding how AI thinks.',
              },
            ],
            quiz: [
              {
                id: 'q-bp-1',
                question: 'A bag contains 3 red marbles and 7 blue marbles. What is the probability of drawing a red marble?',
                options: [
                  '3/7',
                  '3/10',
                  '7/10',
                  '1/3',
                ],
                correctIndex: 1,
                explanation: 'Probability equals favorable outcomes divided by total outcomes. There are 3 red marbles (favorable) out of 10 total marbles. So P(red) = 3/10 = 0.3 or 30%.',
              },
              {
                id: 'q-bp-2',
                question: 'If the probability of rain tomorrow is 0.3, what is the probability it will NOT rain?',
                options: [
                  '0.3',
                  '0.7',
                  '0.0',
                  '1.3',
                ],
                correctIndex: 1,
                explanation: 'The complement rule states that P(not A) = 1 - P(A). If P(rain) = 0.3, then P(no rain) = 1 - 0.3 = 0.7. The probabilities of all possible outcomes must add up to 1.',
              },
              {
                id: 'q-bp-3',
                question: 'What does the Law of Large Numbers state?',
                options: [
                  'Large numbers are always more probable than small ones',
                  'As you repeat an experiment more times, the observed frequency approaches the theoretical probability',
                  'You need large numbers to calculate probability',
                  'Probability only works with large datasets',
                ],
                correctIndex: 1,
                explanation: 'The Law of Large Numbers states that as the number of trials increases, the observed proportion of outcomes converges toward the theoretical probability. Flip a fair coin 10 times and you might get 70% heads, but flip it 10,000 times and you will get very close to 50%.',
              },
            ],
          },
          {
            id: 'expected-value',
            title: 'Expected Value',
            subtitle: 'What to expect on average',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Calculating Expected Value',
                content: 'Expected value is the average outcome you would get if you repeated an experiment infinitely many times. It is calculated by multiplying each possible outcome by its probability and summing the results. For example, if you bet $1 on a coin flip and win $2 for heads but lose $1 for tails, the expected value is (0.5 x $2) + (0.5 x -$1) = $0.50. Over many bets, you would average a $0.50 gain per bet.',
                bulletPoints: [
                  'EV = sum of (each outcome x its probability)',
                  'Positive EV: favorable in the long run',
                  'Negative EV: unfavorable in the long run',
                  'EV helps make rational decisions under uncertainty',
                  'Casinos always have negative EV for players — that is their business model',
                ],
              },
              {
                type: 'explore',
                title: 'Expected Value in Real Life',
                content: 'Insurance companies use expected value to set premiums. If 1 in 1,000 homes has a $200,000 fire each year, the expected loss per home is $200. The insurance company charges more than $200 per home to cover the expected loss plus profit. Lottery tickets almost always have negative expected value — the average payout is less than the ticket price.',
              },
              {
                type: 'challenge',
                title: 'Design a Fair Game',
                content: 'Design a dice game where two players have equal expected values (a "fair" game). Then modify it so Player A has a slight advantage. Calculate the expected value for each player in both versions. Now design a game that looks fair but secretly favors one player — this is how many carnival games work.',
              },
              {
                type: 'reflect',
                title: 'Beyond Expected Value',
                content: 'Expected value is powerful but has limitations. A game where you win $1 million with 50% probability or lose $999,999 with 50% probability has a positive expected value of $0.50, but most rational people would not play. Risk tolerance, potential downside, and personal circumstances all matter beyond the pure expected value calculation.',
              },
            ],
            quiz: [
              {
                id: 'q-ev-1',
                question: 'A game costs $5 to play. You roll a die: if you roll a 6, you win $24. Otherwise you win nothing. What is the expected value?',
                options: [
                  '+$4.00',
                  '-$1.00',
                  '+$19.00',
                  '$0.00',
                ],
                correctIndex: 1,
                explanation: 'EV = (1/6 x $24) + (5/6 x $0) - $5 = $4 - $5 = -$1. On average, you lose $1 each time you play. The game has negative expected value for the player.',
              },
              {
                id: 'q-ev-2',
                question: 'Why do casinos always make money in the long run?',
                options: [
                  'Because they cheat',
                  'Because every game is designed to have a negative expected value for the player',
                  'Because players always make bad decisions',
                  'Because casinos have lucky buildings',
                ],
                correctIndex: 1,
                explanation: 'Every casino game is mathematically designed so that the expected value is negative for the player and positive for the casino. While individual players can win in the short term, the mathematics guarantee that over millions of bets, the casino always profits.',
              },
              {
                id: 'q-ev-3',
                question: 'A lottery ticket costs $2. The jackpot is $10,000,000 with a 1 in 20,000,000 chance of winning. What is the expected value of buying a ticket?',
                options: [
                  '+$10,000,000',
                  '+$0.50',
                  '-$1.50',
                  '-$2.00',
                ],
                correctIndex: 2,
                explanation: 'EV = (1/20,000,000 x $10,000,000) + (19,999,999/20,000,000 x $0) - $2 = $0.50 - $2 = -$1.50. On average, each ticket loses $1.50. The lottery has a very negative expected value, which is why it is sometimes called a "tax on people who are bad at math."',
              },
            ],
          },
          {
            id: 'bayes-theorem',
            title: 'Bayes\' Theorem Simplified',
            subtitle: 'Updating beliefs with evidence',
            xpReward: 50,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'What Is Bayes\' Theorem?',
                content: 'Bayes\' Theorem is a formula for updating your beliefs when you receive new evidence. It answers questions like: "Given that a medical test came back positive, what is the actual probability I have the disease?" The answer depends on three things: how common the disease is (prior probability), how accurate the test is at detecting the disease (sensitivity), and how often the test gives false positives.',
                bulletPoints: [
                  'Prior probability: what you believed before seeing evidence',
                  'Likelihood: how probable the evidence is if your belief is true',
                  'Posterior probability: your updated belief after seeing evidence',
                  'P(A|B) = P(B|A) x P(A) / P(B)',
                  'The key insight: rare events can produce mostly false positives even with accurate tests',
                ],
              },
              {
                type: 'explore',
                title: 'The Base Rate Trap',
                content: 'Imagine a disease that affects 1 in 1,000 people and a test that is 99% accurate. If you test positive, what is the probability you actually have the disease? Most people guess 99%, but the real answer is about 9%. This is because the 1% false positive rate generates many more false alarms in the healthy population (999 people) than the 99% detection rate generates true positives in the tiny sick population (1 person). This is the base rate trap.',
              },
              {
                type: 'challenge',
                title: 'Apply Bayes\' Theorem',
                content: 'Work through this scenario: A spam filter correctly identifies 98% of spam (sensitivity) and correctly identifies 95% of legitimate email (specificity). If 20% of all email is spam, what is the probability that an email flagged as spam is actually spam? Use Bayes\' Theorem to calculate the answer. Hint: draw a tree diagram or use a 2x2 table with 1000 hypothetical emails.',
              },
              {
                type: 'reflect',
                title: 'Bayesian Thinking in AI',
                content: 'Many AI systems are Bayesian at their core — they start with prior beliefs and update them as they receive new data. Every email a spam filter processes makes it slightly more informed. Every interaction with a recommendation system refines its model of your preferences. Understanding Bayes\' Theorem means understanding the fundamental logic of how AI learns from experience.',
              },
            ],
            quiz: [
              {
                id: 'q-bt-1',
                question: 'In Bayes\' Theorem, what is the "prior probability"?',
                options: [
                  'The probability calculated after seeing evidence',
                  'The probability you assigned to something BEFORE seeing new evidence',
                  'The most recent probability calculation',
                  'The probability that the evidence is correct',
                ],
                correctIndex: 1,
                explanation: 'The prior probability represents your initial belief about how likely something is before you receive new evidence. Bayes\' Theorem then updates this prior using the new evidence to produce the posterior probability — your revised belief.',
              },
              {
                id: 'q-bt-2',
                question: 'A disease affects 1 in 1,000 people. A test is 99% accurate. You test positive. What is approximately the probability you have the disease?',
                options: [
                  '99%',
                  '50%',
                  'About 9%',
                  '1%',
                ],
                correctIndex: 2,
                explanation: 'This is the base rate trap. Despite the test being 99% accurate, the disease is so rare that false positives from the 999 healthy people (about 10) vastly outnumber the true positives from the 1 sick person. Out of about 11 positive results, only about 1 is a true positive: roughly 1/11 ≈ 9%.',
              },
              {
                id: 'q-bt-3',
                question: 'How do AI systems use Bayesian reasoning?',
                options: [
                  'They do not — Bayes\' Theorem is only used in medicine',
                  'They start with prior beliefs and update them as they receive new data',
                  'They use it only for image generation',
                  'They apply it once during initial programming and never again',
                ],
                correctIndex: 1,
                explanation: 'Many AI systems are fundamentally Bayesian. Spam filters update their model of spam characteristics with each email processed. Recommendation systems refine their model of your preferences with each interaction. This continuous updating based on new evidence is Bayesian reasoning in action.',
              },
            ],
          },
        ],
      },
      // MODULE 3: Algebra Through Algorithms
      {
        id: 'algebra-algorithms',
        title: 'Algebra Through Algorithms',
        subtitle: 'Variables functions patterns',
        description: 'See algebra come alive through algorithms and real-world applications, from variables and functions to optimization.',
        icon: 'variable',
        color: '#6366f1',
        difficulty: 'intermediate',
        ageRange: '12-14',
        badgeId: 'badge-algebra-algorithms',
        badgeName: 'Algorithm Ace',
        lessons: [
          {
            id: 'variables-functions',
            title: 'Variables & Functions',
            subtitle: 'The building blocks of algorithms',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Variables Are Containers',
                content: 'A variable is a named container that holds a value which can change. In math, x might represent any number. In programming, a variable like "score" holds a player\'s current points. In AI, variables represent everything from pixel values to word frequencies. Understanding variables as flexible placeholders is the key to both algebra and programming.',
                bulletPoints: [
                  'Variables hold values that can change during a computation',
                  'In algebra: x, y, z represent unknown or changing quantities',
                  'In programming: named containers like score, temperature, username',
                  'In AI: parameters, features, weights — all are variables',
                ],
              },
              {
                type: 'learn',
                title: 'Functions as Machines',
                content: 'A function takes an input, processes it according to a rule, and produces an output. The function f(x) = 2x + 1 takes any number, doubles it, and adds 1. In programming, a function might take a username and return a greeting. In AI, a neural network is essentially a very complex function that takes data as input and produces a prediction as output.',
                bulletPoints: [
                  'Every function has inputs (domain) and outputs (range)',
                  'The same input always produces the same output',
                  'Functions can be composed: g(f(x)) applies f first, then g',
                  'AI models are complex functions with millions of parameters',
                ],
              },
              {
                type: 'challenge',
                title: 'Function Machines',
                content: 'Create a chain of three simple functions that transform a number step by step. For example: f(x) = x + 3, g(x) = 2x, h(x) = x - 1. Calculate h(g(f(4))). Now reverse the order and calculate f(g(h(4))). Does order matter? This demonstrates that function composition is not commutative — a concept critical in AI where the order of operations matters enormously.',
              },
              {
                type: 'reflect',
                title: 'Algebra Is Everywhere in AI',
                content: 'Every AI model is built on algebraic foundations. Variables store data, functions transform it, and equations define relationships. When you learn algebra, you are learning the language that AI speaks. The better you understand these fundamentals, the more deeply you will understand how AI actually works under the hood.',
              },
            ],
            quiz: [
              {
                id: 'q-vf-1',
                question: 'What is a function in mathematical terms?',
                options: [
                  'A number that never changes',
                  'A rule that takes an input and produces exactly one output for each input',
                  'A type of graph',
                  'A variable with a specific value',
                ],
                correctIndex: 1,
                explanation: 'A function is a rule that assigns exactly one output to each input. For f(x) = 2x + 1, the input 3 always produces the output 7. This deterministic relationship between inputs and outputs is fundamental to both mathematics and computing.',
              },
              {
                id: 'q-vf-2',
                question: 'If f(x) = x + 2 and g(x) = 3x, what is g(f(5))?',
                options: [
                  '17',
                  '21',
                  '13',
                  '25',
                ],
                correctIndex: 1,
                explanation: 'First apply f: f(5) = 5 + 2 = 7. Then apply g to that result: g(7) = 3 x 7 = 21. Function composition means applying functions in sequence, with each output becoming the next input.',
              },
              {
                id: 'q-vf-3',
                question: 'How are AI neural networks related to mathematical functions?',
                options: [
                  'They are not related at all',
                  'A neural network is essentially a very complex function that maps inputs to outputs',
                  'Neural networks replace the need for functions',
                  'Functions are only used to name neural networks',
                ],
                correctIndex: 1,
                explanation: 'A neural network is a complex mathematical function composed of many simpler functions (layers). It takes input data (like an image or text), applies a series of transformations through its layers, and produces an output (like a classification or prediction).',
              },
            ],
          },
          {
            id: 'linear-exponential-growth',
            title: 'Linear & Exponential Growth',
            subtitle: 'How things grow — slowly and explosively',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Linear Growth',
                content: 'Linear growth adds a constant amount in each time period. If you save $10 per week, your savings grow linearly: $10, $20, $30, $40. The graph is a straight line. Linear relationships are described by y = mx + b, where m is the slope (rate of change) and b is the starting value. Many everyday quantities grow linearly — your age, a car driving at constant speed, fixed weekly allowance.',
                bulletPoints: [
                  'Constant rate of change — same amount added each period',
                  'Graph is a straight line',
                  'Formula: y = mx + b (slope-intercept form)',
                  'm = rate of change, b = starting value',
                ],
              },
              {
                type: 'learn',
                title: 'Exponential Growth',
                content: 'Exponential growth multiplies by a constant factor in each time period. If a population doubles every year starting from 1, it goes 1, 2, 4, 8, 16, 32. The graph curves upward dramatically. Exponential growth starts slow but quickly becomes explosive. AI computing power, data generation, and social media viral spread all follow exponential patterns.',
                bulletPoints: [
                  'Constant percentage change — multiplied by the same factor each period',
                  'Graph curves upward (or downward for decay) dramatically',
                  'Formula: y = a x b^x, where b is the growth factor',
                  'Doubling time: how long it takes to double (related to growth rate)',
                ],
              },
              {
                type: 'explore',
                title: 'The Rice on the Chessboard',
                content: 'The classic story: a king offers a reward, and the clever inventor asks for rice on a chessboard — 1 grain on the first square, 2 on the second, 4 on the third, doubling each time. By the 64th square, the total is over 18 quintillion grains — more rice than exists on Earth. This is exponential growth. AI progress follows similar patterns: each improvement enables the next, leading to rapid acceleration.',
              },
              {
                type: 'challenge',
                title: 'Growth Comparison',
                content: 'Compare these two scenarios: (A) You get $100 per day for 30 days. (B) You get 1 cent on day 1, doubling each day for 30 days. Calculate the total for each. Option A gives you $3,000. Option B gives you over $10.7 million. Create a table showing both values for each day and a graph comparing them. Identify the crossover point where B overtakes A.',
              },
            ],
            quiz: [
              {
                id: 'q-leg-1',
                question: 'What is the key difference between linear and exponential growth?',
                options: [
                  'Linear is faster and exponential is slower',
                  'Linear adds a constant amount each period; exponential multiplies by a constant factor',
                  'They are the same thing with different names',
                  'Exponential growth only applies to populations',
                ],
                correctIndex: 1,
                explanation: 'Linear growth adds the same amount each period (e.g., +$10 per week), producing a straight line. Exponential growth multiplies by the same factor each period (e.g., x2 per year), producing a curve that starts slow but accelerates dramatically.',
              },
              {
                id: 'q-leg-2',
                question: 'If a value doubles every year starting at 1, what is it after 10 years?',
                options: [
                  '10',
                  '20',
                  '100',
                  '1,024',
                ],
                correctIndex: 3,
                explanation: 'Doubling every year for 10 years means multiplying by 2 ten times: 2^10 = 1,024. This is why exponential growth is so powerful — what starts as a small number (1) becomes over a thousand in just 10 doublings.',
              },
              {
                id: 'q-leg-3',
                question: 'Why is understanding exponential growth important for understanding AI?',
                options: [
                  'Because all AI algorithms use exponential functions',
                  'Because computing power, data generation, and AI capabilities have followed exponential growth patterns',
                  'Because exponential growth is the only type of math in AI',
                  'Because AI cannot understand linear growth',
                ],
                correctIndex: 1,
                explanation: 'Computing power (Moore\'s Law), data generation, and AI capabilities have all shown exponential growth patterns. Understanding exponential growth helps you grasp why AI progress has been accelerating and what the implications of continued exponential improvement might be.',
              },
            ],
          },
          {
            id: 'optimization-problems',
            title: 'Optimization Problems',
            subtitle: 'Finding the best solution',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Is Optimization?',
                content: 'Optimization is finding the best solution from all possible solutions, given constraints. Maximize profit, minimize cost, find the shortest route, or allocate resources most efficiently — these are all optimization problems. AI training is fundamentally an optimization problem: find the model parameters that minimize prediction errors on the training data.',
                bulletPoints: [
                  'Objective function: what you want to maximize or minimize',
                  'Variables: the things you can adjust',
                  'Constraints: limits on what is possible',
                  'Optimal solution: the best achievable outcome given constraints',
                ],
              },
              {
                type: 'explore',
                title: 'Optimization in Daily Life',
                content: 'You solve optimization problems daily. Finding the fastest route to school (minimize time, constraint: available roads). Packing a suitcase (maximize items, constraint: suitcase size). Studying for exams (maximize grades, constraint: available time). Once you recognize the pattern — objective, variables, constraints — you see optimization everywhere.',
              },
              {
                type: 'challenge',
                title: 'The Lemonade Stand',
                content: 'You run a lemonade stand. Lemons cost $0.50 each and make 3 cups. Sugar costs $2 per bag (enough for 20 cups). You can charge $1-$3 per cup. At $1, you sell 30 cups/day. At $2, you sell 15 cups. At $3, you sell 5 cups. What price maximizes your daily profit? Calculate the costs and revenue at each price point to find the optimal solution.',
              },
              {
                type: 'reflect',
                title: 'The Optimization Mindset',
                content: 'Optimization is not about perfection — it is about making the best decision given real-world constraints. Every AI system, from route planners to language models, is solving an optimization problem. Learning to think in terms of objectives, variables, and constraints gives you a framework for approaching any complex decision.',
              },
            ],
            quiz: [
              {
                id: 'q-op-1',
                question: 'What are the three key components of an optimization problem?',
                options: [
                  'Speed, accuracy, and cost',
                  'Objective function, variables, and constraints',
                  'Input, process, and output',
                  'Data, model, and prediction',
                ],
                correctIndex: 1,
                explanation: 'Every optimization problem has an objective function (what to maximize or minimize), variables (what you can adjust), and constraints (limits on the solution space). Together, these define the problem and determine the optimal solution.',
              },
              {
                id: 'q-op-2',
                question: 'How is AI training an optimization problem?',
                options: [
                  'It is not — AI training uses a different type of math',
                  'The goal is to find model parameters that minimize prediction errors on training data',
                  'The goal is to maximize the number of parameters in the model',
                  'The goal is to minimize the training time regardless of accuracy',
                ],
                correctIndex: 1,
                explanation: 'AI training is fundamentally an optimization problem where the objective is to minimize the loss function (prediction errors) by adjusting the model\'s parameters. The variables are the millions of weights in the neural network, and constraints include the model architecture and training data.',
              },
              {
                id: 'q-op-3',
                question: 'Why is optimization described as finding the "best" solution rather than the "perfect" solution?',
                options: [
                  'Because computers cannot find perfect solutions',
                  'Because real-world constraints mean the theoretically perfect solution is often not achievable',
                  'Because "perfect" is not a mathematical term',
                  'Because optimization always produces the same answer regardless of constraints',
                ],
                correctIndex: 1,
                explanation: 'In real-world problems, constraints (limited budget, time, resources) mean you cannot have everything. Optimization finds the best achievable outcome given these trade-offs. The "optimal" solution is the best you can do within your constraints, not an abstract ideal.',
              },
            ],
          },
        ],
      },
      // MODULE 4: Geometry & Graphics
      {
        id: 'geometry-graphics',
        title: 'Geometry & Graphics',
        subtitle: 'Shapes space pixels',
        description: 'Explore how geometry powers computer graphics, from coordinate systems to image processing.',
        icon: 'shapes',
        color: '#6366f1',
        difficulty: 'intermediate',
        ageRange: '12-14',
        badgeId: 'badge-geometry-graphics',
        badgeName: 'Pixel Master',
        lessons: [
          {
            id: 'coordinate-geometry',
            title: 'Coordinate Geometry',
            subtitle: 'Placing math on a grid',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'The Coordinate Plane',
                content: 'The coordinate plane is a two-dimensional grid defined by a horizontal x-axis and a vertical y-axis. Every point is identified by an ordered pair (x, y). This system, invented by Rene Descartes, bridges algebra and geometry — you can describe geometric shapes with equations and visualize equations as geometric shapes. Every pixel on your screen is identified by coordinates.',
                bulletPoints: [
                  'Origin (0,0) is where the axes cross',
                  'x-coordinate: horizontal position (left/right)',
                  'y-coordinate: vertical position (up/down)',
                  'Distance formula: d = sqrt((x2-x1)^2 + (y2-y1)^2)',
                  'Midpoint formula: ((x1+x2)/2, (y1+y2)/2)',
                ],
              },
              {
                type: 'explore',
                title: 'Coordinates in Computing',
                content: 'Computer screens use coordinate systems to position every element you see. Screen coordinates typically start at (0,0) in the top-left corner, with x increasing rightward and y increasing downward. Game developers use coordinate systems to position characters and detect collisions. GPS uses latitude and longitude — a coordinate system for the entire planet.',
              },
              {
                type: 'challenge',
                title: 'Pixel Art Math',
                content: 'On graph paper, plot these points and connect them in order to reveal a shape: (2,1), (4,3), (6,1), (5,4), (7,6), (4,5), (1,6), (3,4), (2,1). Calculate the total perimeter by finding the distance between each consecutive pair of points using the distance formula. This connects abstract math to visual creation.',
              },
              {
                type: 'connect',
                title: 'From 2D to 3D',
                content: 'Adding a z-axis extends coordinate geometry into three dimensions. Every point in 3D space is identified by (x, y, z). This is how 3D graphics, virtual reality, and computer vision work. Objects in a 3D game or a CAD model are defined by thousands of coordinate points connected by edges and faces.',
              },
            ],
            quiz: [
              {
                id: 'q-cg-1',
                question: 'What is the distance between points (1, 2) and (4, 6)?',
                options: [
                  '5',
                  '7',
                  '3',
                  '25',
                ],
                correctIndex: 0,
                explanation: 'Using the distance formula: d = sqrt((4-1)^2 + (6-2)^2) = sqrt(9 + 16) = sqrt(25) = 5. This is also a 3-4-5 right triangle, one of the most common Pythagorean triples.',
              },
              {
                id: 'q-cg-2',
                question: 'How do computer screens typically set up their coordinate system?',
                options: [
                  '(0,0) at the center, with y increasing upward',
                  '(0,0) at the top-left corner, with y increasing downward',
                  '(0,0) at the bottom-right corner',
                  'Screens do not use coordinate systems',
                ],
                correctIndex: 1,
                explanation: 'Most computer displays place (0,0) at the top-left corner. The x-axis increases to the right, and the y-axis increases downward. This is opposite to standard math convention (where y increases upward) and is something to keep in mind when working with computer graphics.',
              },
              {
                id: 'q-cg-3',
                question: 'What does adding a z-axis to a coordinate system enable?',
                options: [
                  'Faster computations',
                  'Representation of three-dimensional space and 3D graphics',
                  'More colors on screen',
                  'Sound processing',
                ],
                correctIndex: 1,
                explanation: 'Adding a z-axis creates a three-dimensional coordinate system where every point is described by (x, y, z). This enables 3D graphics, virtual reality, 3D printing, and any application that needs to model objects in three-dimensional space.',
              },
            ],
          },
          {
            id: 'transformations',
            title: 'Transformations',
            subtitle: 'Moving, scaling, and rotating shapes',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Basic Transformations',
                content: 'Geometric transformations change the position, size, or orientation of shapes. Translation slides a shape without changing it. Rotation turns it around a point. Scaling makes it larger or smaller. Reflection flips it across a line. These four transformations are the building blocks of all computer graphics — every animation, game, and visual effect uses them.',
                bulletPoints: [
                  'Translation: moving a shape without changing its size or orientation',
                  'Rotation: turning a shape around a fixed point by an angle',
                  'Scaling: making a shape larger or smaller by a factor',
                  'Reflection: flipping a shape across a line (mirror image)',
                ],
              },
              {
                type: 'explore',
                title: 'Transformations as Math',
                content: 'Each transformation can be described mathematically. Translation adds a value to coordinates: (x+a, y+b). Scaling multiplies coordinates: (sx, sy). Rotation uses trigonometry: (x cos(t) - y sin(t), x sin(t) + y cos(t)). In computer graphics, these are represented as matrices, and combining transformations is done by multiplying matrices together.',
              },
              {
                type: 'challenge',
                title: 'Transform a Character',
                content: 'Draw a simple character on graph paper (a stick figure or simple shape) using at least 6 coordinate points. Apply each transformation: translate it 5 units right, scale it by a factor of 2, rotate it 90 degrees around the origin, and reflect it across the y-axis. Draw the result of each transformation. This is exactly what a game engine does every frame.',
              },
              {
                type: 'reflect',
                title: 'Transformations in AI',
                content: 'Data augmentation in AI uses transformations to create more training data. A single photo of a cat can become many training examples by rotating, scaling, flipping, and shifting it. This teaches the AI model that a cat is still a cat regardless of its position, size, or orientation in the image — a concept called invariance.',
              },
            ],
            quiz: [
              {
                id: 'q-tr-1',
                question: 'Which transformation changes a shape\'s size without changing its position?',
                options: [
                  'Translation',
                  'Rotation',
                  'Scaling',
                  'Reflection',
                ],
                correctIndex: 2,
                explanation: 'Scaling multiplies all coordinates by a factor, making the shape larger (factor > 1) or smaller (factor < 1). When scaling is done relative to the origin, the shape also moves, but the key change is to its size.',
              },
              {
                id: 'q-tr-2',
                question: 'If point (3, 4) is translated by (2, -1), what are the new coordinates?',
                options: [
                  '(5, 3)',
                  '(1, 5)',
                  '(6, -4)',
                  '(5, 5)',
                ],
                correctIndex: 0,
                explanation: 'Translation adds the translation values to the original coordinates: (3+2, 4+(-1)) = (5, 3). Translation simply shifts every point by the same amount without changing the shape.',
              },
              {
                id: 'q-tr-3',
                question: 'How does AI use geometric transformations in training?',
                options: [
                  'To make models spin on screen',
                  'To create additional training examples through data augmentation (rotating, flipping, scaling images)',
                  'To transform text into images',
                  'Transformations are not used in AI',
                ],
                correctIndex: 1,
                explanation: 'Data augmentation applies transformations like rotation, flipping, scaling, and shifting to existing training images to create additional examples. This helps the model learn that the subject is the same regardless of position or orientation, improving generalization.',
              },
            ],
          },
          {
            id: 'how-computers-see',
            title: 'How Computers See Images',
            subtitle: 'Pixels, channels, and features',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'Images Are Numbers',
                content: 'To a computer, an image is a grid of numbers. Each pixel has a value (0-255 for grayscale, or three values for RGB color). A 1920x1080 HD image contains over 2 million pixels, each with three color values — that is over 6 million numbers. Computer vision AI processes these number grids to detect objects, recognize faces, and understand scenes.',
                bulletPoints: [
                  'Grayscale: each pixel is one number (0 = black, 255 = white)',
                  'RGB color: each pixel has three numbers (Red, Green, Blue), each 0-255',
                  'Resolution: the width x height in pixels',
                  'An HD image is a 1920 x 1080 x 3 array of numbers',
                ],
              },
              {
                type: 'explore',
                title: 'From Pixels to Features',
                content: 'AI does not "see" images the way humans do. Convolutional Neural Networks (CNNs) scan images with small filters that detect basic features: edges, corners, textures. Deeper layers combine these basic features into more complex ones: an edge plus a curve might become an eye, eyes plus a nose might become a face. This hierarchical feature detection is how AI learns to recognize objects.',
              },
              {
                type: 'challenge',
                title: 'Pixel Art Encoding',
                content: 'Create a simple 8x8 pixel art image using only three colors. Write out the numerical representation as a grid of numbers (use 0, 1, and 2 for your three colors). Now swap two of the numbers and redraw the image. You have just experienced data corruption — a single number change can alter the entire picture. This demonstrates why data integrity matters in computer vision.',
              },
              {
                type: 'reflect',
                title: 'The Gap Between Seeing and Understanding',
                content: 'Computers can now identify objects in images with superhuman accuracy, but they still do not "understand" images the way you do. A computer vision system might recognize a stop sign perfectly but does not understand the concept of traffic safety. This gap between pattern recognition and genuine understanding is one of the deepest challenges in AI research.',
              },
            ],
            quiz: [
              {
                id: 'q-hcs-1',
                question: 'How is a color image represented in a computer?',
                options: [
                  'As a text description of what the image shows',
                  'As a grid of pixels, each containing three numbers (Red, Green, Blue) ranging from 0-255',
                  'As a single very large number',
                  'As a vector drawing with mathematical equations',
                ],
                correctIndex: 1,
                explanation: 'A digital color image is stored as a grid of pixels. Each pixel contains three values representing the intensity of Red, Green, and Blue light (0-255 each). Combined, these three channels produce the full spectrum of visible colors.',
              },
              {
                id: 'q-hcs-2',
                question: 'What do the first layers of a Convolutional Neural Network (CNN) typically detect?',
                options: [
                  'Complete objects like faces and cars',
                  'Simple features like edges, corners, and textures',
                  'The meaning and context of the image',
                  'The file format of the image',
                ],
                correctIndex: 1,
                explanation: 'The early layers of a CNN detect simple, low-level features like edges, corners, color gradients, and textures. These basic features are then combined in deeper layers to form increasingly complex patterns — from simple shapes to object parts to complete objects.',
              },
              {
                id: 'q-hcs-3',
                question: 'How many total numbers are needed to store a 100x100 pixel RGB color image?',
                options: [
                  '10,000',
                  '30,000',
                  '100,000',
                  '1,000,000',
                ],
                correctIndex: 1,
                explanation: '100 x 100 pixels = 10,000 pixels. Each pixel has 3 color channels (R, G, B). So the total is 10,000 x 3 = 30,000 numbers. This is the raw uncompressed data needed to represent every color in every pixel of the image.',
              },
            ],
          },
        ],
      },
      // MODULE 5: Linear Algebra
      {
        id: 'linear-algebra',
        title: 'Linear Algebra',
        subtitle: 'The math inside AI',
        description: 'Explore vectors, matrices, and operations that form the mathematical backbone of modern AI and machine learning.',
        icon: 'matrix',
        color: '#6366f1',
        difficulty: 'advanced',
        ageRange: '14-18',
        badgeId: 'badge-linear-algebra',
        badgeName: 'Matrix Master',
        lessons: [
          {
            id: 'vectors-operations',
            title: 'Vectors & Operations',
            subtitle: 'Direction, magnitude, and meaning',
            xpReward: 100,
            durationMinutes: 22,
            sections: [
              {
                type: 'learn',
                title: 'What Is a Vector?',
                content: 'A vector is an ordered list of numbers that represents both a direction and a magnitude. In 2D, the vector [3, 4] points from the origin to the point (3, 4) with a length of 5. But vectors are not just arrows on paper — they are how AI represents everything. A word can be a vector of 768 numbers. An image can be a vector of millions of numbers. Vectors are the universal language of data in AI.',
                bulletPoints: [
                  'A vector is an ordered list of numbers [a, b, c, ...]',
                  'Magnitude: the "length" of the vector, calculated using the Pythagorean theorem',
                  'Direction: where the vector "points" in its space',
                  'Dimension: how many numbers are in the vector',
                  'In AI, data is almost always represented as vectors',
                ],
              },
              {
                type: 'learn',
                title: 'Vector Operations',
                content: 'Vector addition adds corresponding elements: [1,2] + [3,4] = [4,6]. Scalar multiplication multiplies every element by a number: 2 x [1,2] = [2,4]. The dot product multiplies corresponding elements and sums: [1,2] . [3,4] = 1x3 + 2x4 = 11. The dot product is especially important in AI — it measures how similar two vectors are, which is how AI calculates relevance, similarity, and attention.',
                bulletPoints: [
                  'Addition: [a,b] + [c,d] = [a+c, b+d]',
                  'Scalar multiplication: k x [a,b] = [ka, kb]',
                  'Dot product: [a,b] . [c,d] = ac + bd (measures similarity)',
                  'High dot product = vectors point in similar directions = similar',
                  'The dot product is the single most important operation in modern AI',
                ],
              },
              {
                type: 'challenge',
                title: 'Vector Similarity',
                content: 'Calculate the dot product of these pairs: [1,0] and [0,1]; [1,1] and [1,1]; [1,0] and [-1,0]. The results are 0, 2, and -1. Zero means perpendicular (unrelated), positive means similar direction, negative means opposite. This is exactly how AI measures whether two pieces of text are about similar topics — by computing the dot product of their vector representations.',
              },
              {
                type: 'reflect',
                title: 'Why Vectors Matter for AI',
                content: 'Every modern AI system converts its inputs into vectors. Text, images, audio, and user behavior are all transformed into numerical vectors. AI then performs vector operations — primarily dot products — to find patterns, calculate similarities, and make predictions. Linear algebra is not just useful for AI; it IS the math of AI.',
              },
            ],
            quiz: [
              {
                id: 'q-vo-1',
                question: 'What is the dot product of [2, 3] and [4, 1]?',
                options: [
                  '[8, 3]',
                  '11',
                  '14',
                  '[6, 4]',
                ],
                correctIndex: 1,
                explanation: 'The dot product multiplies corresponding elements and sums: (2x4) + (3x1) = 8 + 3 = 11. The result is a single number (scalar), not a vector. This scalar represents how "aligned" the two vectors are.',
              },
              {
                id: 'q-vo-2',
                question: 'If the dot product of two vectors is 0, what does that mean?',
                options: [
                  'The vectors are identical',
                  'The vectors are perpendicular (orthogonal) — they are unrelated in direction',
                  'One of the vectors is zero',
                  'The calculation was done incorrectly',
                ],
                correctIndex: 1,
                explanation: 'A dot product of 0 means the vectors are orthogonal (perpendicular). In AI, this means the two data points are "unrelated" — they share no directional similarity. Positive dot products indicate similarity, and negative dot products indicate opposition.',
              },
              {
                id: 'q-vo-3',
                question: 'Why is the dot product considered the most important operation in modern AI?',
                options: [
                  'Because it is the easiest operation to compute',
                  'Because it measures similarity between data representations, enabling search, recommendations, and attention mechanisms',
                  'Because it was invented specifically for AI',
                  'Because other operations do not work on computers',
                ],
                correctIndex: 1,
                explanation: 'The dot product is central to AI because it measures how similar two vector representations are. This powers search (finding similar documents), recommendations (finding similar users/items), attention mechanisms in transformers (finding relevant context), and much more.',
              },
            ],
          },
          {
            id: 'matrix-multiplication',
            title: 'Matrix Multiplication',
            subtitle: 'The engine of neural networks',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'What Is a Matrix?',
                content: 'A matrix is a rectangular grid of numbers arranged in rows and columns. A 2x3 matrix has 2 rows and 3 columns. Matrices can represent datasets (rows = samples, columns = features), images (rows and columns of pixel values), transformations, and neural network weights. Almost every computation in AI involves matrix operations.',
                bulletPoints: [
                  'A matrix is a 2D grid of numbers with m rows and n columns',
                  'Matrices can store datasets, images, transformations, and weights',
                  'Matrix addition: add corresponding elements (same-sized matrices)',
                  'Scalar multiplication: multiply every element by a number',
                  'Transpose: swap rows and columns (flip along the diagonal)',
                ],
              },
              {
                type: 'learn',
                title: 'Matrix Multiplication',
                content: 'Matrix multiplication combines two matrices by taking dot products of rows from the first matrix with columns of the second. For matrices A (m x n) and B (n x p), the result is an (m x p) matrix. The inner dimensions must match. This operation is the mathematical core of neural networks — each layer transforms its input by multiplying it with a weight matrix.',
                bulletPoints: [
                  'A (m x n) times B (n x p) produces C (m x p)',
                  'Each element C[i][j] is the dot product of row i of A with column j of B',
                  'The inner dimensions (n) must match',
                  'Matrix multiplication is NOT commutative: AB is not generally equal to BA',
                  'GPUs are designed specifically to perform matrix multiplications fast',
                ],
              },
              {
                type: 'challenge',
                title: 'Multiply by Hand',
                content: 'Multiply these matrices: [[1, 2], [3, 4]] times [[5, 6], [7, 8]]. Work through each element step by step. The result should be [[19, 22], [43, 50]]. Then try reversing the order. You will get [[23, 34], [31, 46]] — different! This confirms that matrix multiplication order matters, which is why the architecture of neural networks (the order of layers) is so important.',
              },
              {
                type: 'reflect',
                title: 'Why GPUs Matter',
                content: 'GPUs (Graphics Processing Units) were originally designed to render game graphics — which requires millions of matrix operations per second. Researchers discovered that the same hardware could train neural networks, which also require massive matrix multiplications. This is why NVIDIA, a gaming GPU company, became one of the most valuable companies in the world — they make the hardware that powers AI.',
              },
            ],
            quiz: [
              {
                id: 'q-mm-1',
                question: 'If matrix A is 3x4 and matrix B is 4x2, what size is the result of A times B?',
                options: [
                  '3x2',
                  '4x4',
                  '3x4',
                  '2x3',
                ],
                correctIndex: 0,
                explanation: 'When multiplying A (3x4) by B (4x2), the inner dimensions (4) must match (they do), and the result has the outer dimensions: 3 rows from A and 2 columns from B, giving a 3x2 matrix.',
              },
              {
                id: 'q-mm-2',
                question: 'Why is matrix multiplication NOT commutative (AB does not equal BA)?',
                options: [
                  'Because computers make rounding errors',
                  'Because the dot products of different rows and columns produce different results when the order changes',
                  'Because matrix multiplication is actually commutative — the question is wrong',
                  'Because only square matrices can be multiplied',
                ],
                correctIndex: 1,
                explanation: 'When you reverse the multiplication order, different rows are dotted with different columns, producing different results. With non-square matrices, the reversed multiplication might not even be possible (the dimensions may not match). This non-commutativity is why neural network layer order matters.',
              },
              {
                id: 'q-mm-3',
                question: 'Why did GPUs become essential for AI training?',
                options: [
                  'Because AI requires high-quality graphics',
                  'Because GPUs were designed for fast matrix operations, which are also the core computation in neural networks',
                  'Because GPUs are cheaper than CPUs',
                  'Because AI can only run on gaming hardware',
                ],
                correctIndex: 1,
                explanation: 'GPUs were built to perform massive parallel matrix computations for rendering graphics. Neural network training also requires enormous numbers of matrix multiplications. This shared computational need made GPUs ideal for AI training, which is why GPU companies like NVIDIA became central to the AI industry.',
              },
            ],
          },
          {
            id: 'word-embeddings',
            title: 'Word Embeddings',
            subtitle: 'Turning words into vectors',
            xpReward: 100,
            durationMinutes: 22,
            sections: [
              {
                type: 'learn',
                title: 'From Words to Numbers',
                content: 'Computers cannot directly process words — they need numbers. Word embeddings solve this by representing each word as a vector of numbers (typically 100-768 dimensions) where similar words have similar vectors. The word "king" might be [0.2, -0.4, 0.7, ...] while "queen" might be [0.21, -0.38, 0.71, ...] — similar vectors because they have similar meanings.',
                bulletPoints: [
                  'Each word is mapped to a dense vector of real numbers',
                  'Similar words have vectors that are close together',
                  'Vectors capture semantic relationships automatically',
                  'Trained on large text corpora to learn word associations',
                  'Foundation of all modern natural language processing',
                ],
              },
              {
                type: 'explore',
                title: 'Vector Arithmetic with Words',
                content: 'The most famous demonstration of word embeddings is that vector("king") - vector("man") + vector("woman") approximately equals vector("queen"). The vectors capture not just similarity but actual relationships: gender, tense, country-capital, and more. This means you can do math with meanings — a revolutionary concept that enables AI to understand language.',
              },
              {
                type: 'challenge',
                title: 'Explore Embedding Space',
                content: 'Using an online word embedding visualizer (like TensorFlow Embedding Projector), search for a word and explore its nearest neighbors in vector space. Try words from different domains: animals, countries, emotions. Notice how the spatial organization of words reflects their semantic relationships. Words about emotions cluster together, as do country names.',
              },
              {
                type: 'reflect',
                title: 'Embeddings and Bias',
                content: 'Word embeddings learn from human text, which means they also learn human biases. Researchers found that embeddings associated "doctor" more closely with "man" and "nurse" more closely with "woman," reflecting societal stereotypes. This is a powerful example of how AI can inherit and amplify human biases through its mathematical representations.',
              },
            ],
            quiz: [
              {
                id: 'q-we-1',
                question: 'What is a word embedding?',
                options: [
                  'A word hidden inside a sentence',
                  'A numerical vector representation of a word where similar words have similar vectors',
                  'A word translated into another language',
                  'A word written in binary code',
                ],
                correctIndex: 1,
                explanation: 'A word embedding maps each word to a dense vector of real numbers. The key property is that words with similar meanings are represented by similar vectors, allowing AI to work with language mathematically while preserving semantic relationships.',
              },
              {
                id: 'q-we-2',
                question: 'What does the equation king - man + woman ≈ queen demonstrate?',
                options: [
                  'That AI can do basic arithmetic',
                  'That word embeddings capture semantic relationships like gender as vector directions',
                  'That queens are more important than kings',
                  'That AI understands the English monarchy',
                ],
                correctIndex: 1,
                explanation: 'This equation shows that word embeddings encode semantic relationships as geometric directions. The "gender direction" (man → woman) can be applied to transform any gendered word. This demonstrates that embeddings capture meaningful structure, not just word similarity.',
              },
              {
                id: 'q-we-3',
                question: 'How can word embeddings contain bias?',
                options: [
                  'They cannot — math is always unbiased',
                  'They learn from human text that contains stereotypes, so they encode those stereotypes in their vectors',
                  'Programmers intentionally add bias to embeddings',
                  'Bias only exists in image AI, not text AI',
                ],
                correctIndex: 1,
                explanation: 'Word embeddings are trained on text written by humans, which contains societal biases and stereotypes. The model learns these patterns and encodes them in the vector relationships — for example, associating certain professions more closely with one gender. This is a major area of AI fairness research.',
              },
            ],
          },
        ],
      },
      // MODULE 6: Calculus & Optimization
      {
        id: 'calculus-optimization',
        title: 'Calculus & Optimization',
        subtitle: 'How AI learns',
        description: 'Understand the calculus concepts that drive AI training, from rates of change to gradient descent.',
        icon: 'trending',
        color: '#6366f1',
        difficulty: 'advanced',
        ageRange: '15-18',
        badgeId: 'badge-calculus-optimization',
        badgeName: 'Gradient Guide',
        lessons: [
          {
            id: 'rates-of-change',
            title: 'Rates of Change',
            subtitle: 'The derivative explained',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'What Is a Derivative?',
                content: 'A derivative measures how fast a function changes at any given point. If you plot a curve, the derivative at a point is the slope of the tangent line at that point. Speed is the derivative of position — it tells you how fast your position is changing. In AI, the derivative tells us how much the error changes when we slightly adjust a model parameter. This is the mathematical foundation of how AI learns.',
                bulletPoints: [
                  'The derivative measures the instantaneous rate of change',
                  'Geometrically, it is the slope of the tangent line at a point',
                  'Speed is the derivative of position with respect to time',
                  'For f(x) = x^2, the derivative is f\'(x) = 2x',
                  'Derivatives point in the direction of steepest increase',
                ],
              },
              {
                type: 'explore',
                title: 'Derivatives in Everyday Life',
                content: 'You intuitively understand derivatives. When you step on the gas, you feel acceleration — the derivative of velocity. When a social media post "goes viral," the growth rate (derivative of followers) is large and increasing. When economists talk about inflation "slowing," they mean the derivative of prices is decreasing. Calculus formalizes these intuitions.',
              },
              {
                type: 'challenge',
                title: 'Estimate Derivatives Numerically',
                content: 'For the function f(x) = x^2, estimate the derivative at x = 3 by calculating [f(3.001) - f(3)] / 0.001. You should get approximately 6, which matches the formula (derivative of x^2 is 2x, and 2 times 3 equals 6). Try this for x^3 at x = 2. The numerical method always works, even when you do not know the formula.',
              },
              {
                type: 'reflect',
                title: 'Calculus and AI Training',
                content: 'When an AI model makes a prediction, we calculate the error. The derivative of the error with respect to each parameter tells us which direction to adjust that parameter to reduce the error. This is the fundamental principle behind all neural network training. Without calculus, AI as we know it would not exist.',
              },
            ],
            quiz: [
              {
                id: 'q-roc-1',
                question: 'What does the derivative of a function measure?',
                options: [
                  'The total area under the curve',
                  'The average value of the function',
                  'The instantaneous rate of change at a specific point',
                  'The maximum value of the function',
                ],
                correctIndex: 2,
                explanation: 'The derivative measures how fast a function is changing at any specific point. It gives the slope of the tangent line at that point, representing the instantaneous rate of change — not the average change over an interval.',
              },
              {
                id: 'q-roc-2',
                question: 'If f(x) = x^2, what is f\'(3) (the derivative at x=3)?',
                options: [
                  '9',
                  '6',
                  '3',
                  '2',
                ],
                correctIndex: 1,
                explanation: 'The derivative of x^2 is 2x. At x = 3, the derivative is 2(3) = 6. This means at x = 3, the function x^2 is increasing at a rate of 6 units of output per unit of input.',
              },
              {
                id: 'q-roc-3',
                question: 'How do derivatives help AI learn?',
                options: [
                  'They calculate the final answer directly',
                  'They tell us which direction to adjust each parameter to reduce prediction errors',
                  'They measure how much training data is needed',
                  'They determine which programming language to use',
                ],
                correctIndex: 1,
                explanation: 'Derivatives of the error function with respect to model parameters indicate which direction and how much to adjust each parameter to reduce the error. This is the mathematical basis of backpropagation and gradient descent — the algorithms that train neural networks.',
              },
            ],
          },
          {
            id: 'gradient-descent',
            title: 'Gradient Descent',
            subtitle: 'Walking downhill to find the best answer',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'The Gradient',
                content: 'The gradient is the multi-dimensional version of the derivative. For a function with many inputs (like a neural network with millions of parameters), the gradient is a vector of partial derivatives — one for each parameter. It points in the direction of steepest increase. To minimize error, you go in the opposite direction: against the gradient. This is gradient descent.',
                bulletPoints: [
                  'Gradient: a vector of all partial derivatives',
                  'Points in the direction of steepest increase of the function',
                  'To minimize: move in the OPPOSITE direction of the gradient',
                  'Learning rate: how big each step is',
                  'Too large a learning rate: overshooting. Too small: very slow progress.',
                ],
              },
              {
                type: 'explore',
                title: 'The Mountain Analogy',
                content: 'Imagine you are blindfolded on a mountain and need to reach the lowest valley. You feel the ground\'s slope with your feet and take a step in the steepest downhill direction. Then you feel the slope again and step again. Repeat until the ground feels flat — you have found a valley. This is gradient descent. The slope you feel is the gradient, and each step moves your parameters toward lower error.',
              },
              {
                type: 'challenge',
                title: 'Manual Gradient Descent',
                content: 'Minimize f(x) = (x - 3)^2 using gradient descent. The derivative is f\'(x) = 2(x-3). Start at x = 0 with a learning rate of 0.1. Each step: x_new = x - 0.1 * f\'(x). Calculate 10 steps and watch x converge toward 3 (the minimum). Try again with learning rate 0.5 and 1.5 — observe what happens with each.',
              },
              {
                type: 'reflect',
                title: 'Local vs Global Minima',
                content: 'A major challenge with gradient descent is local minima — valleys that are not the deepest. Your algorithm might settle in a shallow valley and miss the deepest one. Neural networks have incredibly complex error landscapes with millions of dimensions. Researchers have discovered that in high dimensions, local minima are less of a problem than saddle points — flat regions that slow learning.',
              },
            ],
            quiz: [
              {
                id: 'q-gd-1',
                question: 'What is gradient descent?',
                options: [
                  'A method for climbing to the highest point on a surface',
                  'An iterative method for finding the minimum of a function by moving against the gradient',
                  'A way to increase the error of a model',
                  'A type of neural network architecture',
                ],
                correctIndex: 1,
                explanation: 'Gradient descent is an optimization algorithm that iteratively moves in the direction opposite to the gradient (steepest downhill direction) to find the minimum of a function. In AI, it minimizes the error function by adjusting model parameters.',
              },
              {
                id: 'q-gd-2',
                question: 'What happens if the learning rate is too large?',
                options: [
                  'The model learns faster and better',
                  'The model overshoots the minimum, potentially bouncing around or diverging',
                  'Nothing — learning rate does not matter',
                  'The model immediately finds the global minimum',
                ],
                correctIndex: 1,
                explanation: 'A learning rate that is too large causes the algorithm to take steps that are too big, overshooting the minimum and potentially oscillating wildly or diverging to infinity. The learning rate must be carefully tuned — large enough for reasonable progress but small enough for stability.',
              },
              {
                id: 'q-gd-3',
                question: 'What is a local minimum?',
                options: [
                  'The smallest number in a dataset',
                  'A valley in the function that is not the deepest (global) minimum',
                  'The first minimum found by the algorithm',
                  'A minimum that only exists in local (not cloud) computing',
                ],
                correctIndex: 1,
                explanation: 'A local minimum is a point that is lower than all nearby points but is not necessarily the lowest point overall (the global minimum). Gradient descent can get trapped in local minima because it only sees the local slope and cannot detect that a deeper valley exists elsewhere.',
              },
            ],
          },
          {
            id: 'training-a-model',
            title: 'Training a Model',
            subtitle: 'Putting it all together',
            xpReward: 100,
            durationMinutes: 25,
            sections: [
              {
                type: 'learn',
                title: 'The Training Loop',
                content: 'Neural network training follows a loop: (1) Forward pass — input data flows through the network to produce a prediction. (2) Loss calculation — compare the prediction to the correct answer. (3) Backward pass (backpropagation) — calculate gradients of the loss with respect to every parameter. (4) Update — adjust parameters using gradient descent. Repeat for thousands of iterations across the entire dataset.',
                bulletPoints: [
                  'Forward pass: data flows through the network to produce output',
                  'Loss function: measures how wrong the prediction is',
                  'Backpropagation: computes gradients using the chain rule of calculus',
                  'Parameter update: weights adjusted by learning_rate x gradient',
                  'Epoch: one complete pass through the entire training dataset',
                ],
              },
              {
                type: 'explore',
                title: 'Backpropagation and the Chain Rule',
                content: 'Backpropagation uses the chain rule of calculus to efficiently compute gradients for every parameter in a deep network. The chain rule says: if y depends on u which depends on x, then dy/dx = dy/du x du/dx. In a neural network with many layers, the chain rule is applied repeatedly, passing gradient information backward from the output through each layer to the input.',
              },
              {
                type: 'challenge',
                title: 'Train a Tiny Network',
                content: 'Using pen and paper, train a single neuron to learn the AND function (inputs: [0,0], [0,1], [1,0], [1,1]; outputs: 0, 0, 0, 1). Start with random weights and a learning rate of 0.1. Perform the forward pass, calculate the error, compute the gradient, and update the weights. After 5-10 iterations, the weights should begin to correctly classify all four inputs.',
              },
              {
                type: 'reflect',
                title: 'The Scale of Modern Training',
                content: 'The process you just did by hand is exactly what happens when training GPT or other large models — just at an incomprehensible scale. GPT-4 has hundreds of billions of parameters, trains on trillions of tokens, and requires thousands of GPUs running for months. The math is the same, but the scale transforms a simple concept into one of the most expensive engineering projects in history.',
              },
            ],
            quiz: [
              {
                id: 'q-tam-1',
                question: 'What are the four steps of the neural network training loop?',
                options: [
                  'Compile, execute, debug, deploy',
                  'Forward pass, loss calculation, backward pass (backpropagation), parameter update',
                  'Input, process, output, save',
                  'Read data, sort data, filter data, export data',
                ],
                correctIndex: 1,
                explanation: 'The training loop consists of: (1) Forward pass — compute predictions, (2) Loss calculation — measure error, (3) Backward pass — compute gradients via backpropagation, and (4) Parameter update — adjust weights using gradient descent. This loop repeats thousands to millions of times.',
              },
              {
                id: 'q-tam-2',
                question: 'What mathematical principle makes backpropagation possible?',
                options: [
                  'The Pythagorean theorem',
                  'The chain rule of calculus',
                  'The quadratic formula',
                  'The distributive property',
                ],
                correctIndex: 1,
                explanation: 'Backpropagation relies on the chain rule of calculus, which allows you to compute the derivative of a composite function by multiplying derivatives along the chain. This enables efficient calculation of how each parameter in a deep network affects the final error.',
              },
              {
                id: 'q-tam-3',
                question: 'What is an "epoch" in model training?',
                options: [
                  'A single training step',
                  'One complete pass through the entire training dataset',
                  'The time it takes to train a model',
                  'A type of neural network layer',
                ],
                correctIndex: 1,
                explanation: 'An epoch is one complete pass through the entire training dataset. Models are typically trained for many epochs — each time through the data, the model has another chance to learn from every example and refine its parameters.',
              },
            ],
          },
        ],
      },
      // MODULE 7: Logic & Discrete Math
      {
        id: 'discrete-math',
        title: 'Logic & Discrete Math',
        subtitle: 'Computational thinking',
        description: 'Build the logical reasoning skills that underpin computer science, from Boolean logic to graph theory and algorithm design.',
        icon: 'logic',
        color: '#6366f1',
        difficulty: 'intermediate',
        ageRange: '13-16',
        badgeId: 'badge-discrete-math',
        badgeName: 'Logic Wizard',
        lessons: [
          {
            id: 'boolean-logic',
            title: 'Boolean Logic',
            subtitle: 'True, false, and everything in between',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Boolean Operations',
                content: 'Boolean logic operates on values that are either TRUE or FALSE. Three fundamental operations combine these values: AND (both must be true), OR (at least one must be true), and NOT (flips true to false and vice versa). Every digital circuit, every if-statement in code, and every search query uses Boolean logic. It is the foundation of all computation.',
                bulletPoints: [
                  'AND: TRUE only when both inputs are TRUE',
                  'OR: TRUE when at least one input is TRUE',
                  'NOT: flips TRUE to FALSE and FALSE to TRUE',
                  'These three operations can build ANY logical expression',
                  'Named after George Boole, who invented this algebra in 1847',
                ],
              },
              {
                type: 'explore',
                title: 'Truth Tables',
                content: 'A truth table lists every possible combination of inputs and their corresponding output. For AND with two inputs, there are four combinations: TT=T, TF=F, FT=F, FF=F. Truth tables are the definitive way to verify logical expressions. They are also used to design circuits, validate AI decision rules, and debug conditional logic in programs.',
              },
              {
                type: 'challenge',
                title: 'Build a Logic Puzzle',
                content: 'Create a truth table for this expression: (A AND B) OR (NOT A AND C). Fill in all 8 rows (A, B, and C each can be T or F). Then describe a real-world scenario this logic could represent. For example: "Approve the loan if (income is high AND credit is good) OR (income is NOT high AND has a co-signer)."',
              },
              {
                type: 'connect',
                title: 'Boolean Logic in AI',
                content: 'While modern AI uses continuous math (probabilities, gradients) more than discrete Boolean logic, the foundation is the same. Neural network activation functions are soft versions of Boolean gates. Decision trees use Boolean splits. Search engines use Boolean operators. Understanding Boolean logic helps you think computationally about any problem.',
              },
            ],
            quiz: [
              {
                id: 'q-bl-1',
                question: 'What is the result of TRUE AND FALSE?',
                options: [
                  'TRUE',
                  'FALSE',
                  'MAYBE',
                  'ERROR',
                ],
                correctIndex: 1,
                explanation: 'The AND operation returns TRUE only when BOTH inputs are TRUE. Since one input is FALSE, the result is FALSE. Think of AND as requiring unanimous agreement — all inputs must be true.',
              },
              {
                id: 'q-bl-2',
                question: 'What is the result of FALSE OR TRUE?',
                options: [
                  'FALSE',
                  'TRUE',
                  'UNDEFINED',
                  'NEITHER',
                ],
                correctIndex: 1,
                explanation: 'The OR operation returns TRUE when at least one input is TRUE. Since one input is TRUE, the result is TRUE. Think of OR as needing just one vote — any true input makes the result true.',
              },
              {
                id: 'q-bl-3',
                question: 'How many rows does a truth table need for an expression with 3 input variables?',
                options: [
                  '3',
                  '6',
                  '8',
                  '9',
                ],
                correctIndex: 2,
                explanation: 'Each variable can be TRUE or FALSE (2 options). With 3 variables, the total combinations are 2^3 = 8. In general, n variables produce 2^n rows. This exponential growth is why truth tables become impractical for expressions with many variables.',
              },
            ],
          },
          {
            id: 'graph-theory-basics',
            title: 'Graph Theory Basics',
            subtitle: 'Connections, networks, and paths',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'What Are Graphs?',
                content: 'In mathematics, a graph is a set of nodes (also called vertices) connected by edges. This is NOT a bar chart or line chart — it is a network diagram. Social networks are graphs (people = nodes, friendships = edges). Road maps are graphs (intersections = nodes, roads = edges). The internet is a graph. AI knowledge graphs represent relationships between concepts.',
                bulletPoints: [
                  'Node (vertex): a point in the graph representing an entity',
                  'Edge: a connection between two nodes representing a relationship',
                  'Directed graph: edges have a direction (like one-way streets)',
                  'Weighted graph: edges have values (like road distances)',
                  'Degree: how many edges connect to a node',
                ],
              },
              {
                type: 'explore',
                title: 'Graph Problems',
                content: 'Graph theory solves practical problems. The shortest path problem finds the fastest route between two nodes (GPS navigation). The traveling salesman problem asks for the shortest route visiting all nodes (delivery optimization). PageRank — Google\'s original algorithm — used graph theory to rank web pages by analyzing the graph of hyperlinks between them.',
              },
              {
                type: 'challenge',
                title: 'Map Your Social Graph',
                content: 'Draw a graph of your friend group. Each person is a node. Draw an edge between two people if they know each other. Who has the most connections (highest degree)? Are there people who connect otherwise separate groups (bridges)? Can you find the shortest path between any two people? This is exactly how social media platforms model relationships.',
              },
              {
                type: 'reflect',
                title: 'Graphs in AI',
                content: 'Graph Neural Networks (GNNs) are a growing area of AI that processes graph-structured data. They can predict molecular properties (atoms as nodes, bonds as edges), recommend friends in social networks, detect fraud by finding unusual patterns in transaction graphs, and power knowledge graphs that help AI understand relationships between concepts.',
              },
            ],
            quiz: [
              {
                id: 'q-gt-1',
                question: 'In graph theory, what is a "node"?',
                options: [
                  'A type of programming bug',
                  'A point in a graph representing an entity, connected to other nodes by edges',
                  'A mathematical equation',
                  'A type of chart used for data visualization',
                ],
                correctIndex: 1,
                explanation: 'A node (or vertex) is a fundamental element of a graph that represents an entity — a person, a city, a web page, an atom, or any other object. Nodes are connected by edges, which represent relationships between them.',
              },
              {
                id: 'q-gt-2',
                question: 'How did Google\'s original PageRank algorithm use graph theory?',
                options: [
                  'It drew bar charts of web traffic',
                  'It analyzed the graph of hyperlinks between web pages to rank their importance',
                  'It counted how many words each page had',
                  'It measured how fast each page loaded',
                ],
                correctIndex: 1,
                explanation: 'PageRank treated the web as a directed graph where pages are nodes and hyperlinks are edges. A page linked to by many important pages was considered more important. This graph-based approach revolutionized web search and made Google dominant.',
              },
              {
                id: 'q-gt-3',
                question: 'What is a "directed graph"?',
                options: [
                  'A graph that only goes in one direction (left to right)',
                  'A graph where edges have a direction, indicating a one-way relationship',
                  'A graph drawn with a ruler',
                  'A graph with no cycles',
                ],
                correctIndex: 1,
                explanation: 'In a directed graph, edges have a direction (shown as arrows) indicating a one-way relationship. For example, in a Twitter follower graph, "A follows B" does not mean "B follows A" — the edge from A to B is directional.',
              },
            ],
          },
          {
            id: 'algorithm-design',
            title: 'Algorithm Design',
            subtitle: 'Solving problems step by step',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Is an Algorithm?',
                content: 'An algorithm is a precise, step-by-step procedure for solving a problem. A recipe is an algorithm. Driving directions are an algorithm. Long division is an algorithm. In computer science, algorithms are evaluated on correctness (does it solve the problem?), efficiency (how fast is it?), and scalability (does it still work with very large inputs?).',
                bulletPoints: [
                  'Precise: every step must be unambiguous',
                  'Finite: must eventually terminate',
                  'Correct: must produce the right answer',
                  'Efficient: should use as few steps as possible',
                  'Scalable: should handle large inputs gracefully',
                ],
              },
              {
                type: 'explore',
                title: 'Algorithm Efficiency: Big O',
                content: 'Big O notation describes how an algorithm\'s running time grows as the input size increases. O(n) means time grows linearly — double the input, double the time. O(n^2) means time grows quadratically — double the input, quadruple the time. O(log n) means time grows very slowly. Understanding Big O helps you choose the right algorithm for the job, especially when dealing with the massive datasets in AI.',
              },
              {
                type: 'challenge',
                title: 'Design a Sorting Algorithm',
                content: 'Without looking up any sorting algorithms, try to design your own method for sorting a list of 10 numbers from smallest to largest. Write out the steps clearly. Then count how many comparisons your algorithm needs. Compare your approach to simple algorithms like bubble sort (compare adjacent pairs) and selection sort (find the minimum, move it to front, repeat).',
              },
              {
                type: 'reflect',
                title: 'Algorithms Are Everywhere',
                content: 'Every app, website, and AI system runs on algorithms. The social media feed algorithm decides what you see. The ride-sharing algorithm matches drivers with riders. The recommendation algorithm suggests what to buy or watch. Understanding algorithms gives you insight into the invisible systems that shape your daily digital experience.',
              },
            ],
            quiz: [
              {
                id: 'q-ad-1',
                question: 'What does O(n^2) mean in Big O notation?',
                options: [
                  'The algorithm always takes exactly n^2 seconds',
                  'The running time grows proportionally to the square of the input size',
                  'The algorithm uses n^2 bytes of memory',
                  'The algorithm has n^2 bugs',
                ],
                correctIndex: 1,
                explanation: 'O(n^2) means the algorithm\'s running time grows proportionally to the square of the input size. If n doubles from 100 to 200, the time roughly quadruples. This quadratic growth makes O(n^2) algorithms impractical for very large inputs.',
              },
              {
                id: 'q-ad-2',
                question: 'Which property is NOT required for something to be a valid algorithm?',
                options: [
                  'It must be precise and unambiguous',
                  'It must eventually terminate',
                  'It must be the fastest possible solution',
                  'It must produce a correct result',
                ],
                correctIndex: 2,
                explanation: 'An algorithm must be precise, finite (terminating), and correct. It does not have to be the fastest possible solution — a slow but correct algorithm is still a valid algorithm. Efficiency is desirable but not a requirement for validity.',
              },
              {
                id: 'q-ad-3',
                question: 'Which Big O complexity grows the SLOWEST as input size increases?',
                options: [
                  'O(n^2)',
                  'O(n)',
                  'O(log n)',
                  'O(n log n)',
                ],
                correctIndex: 2,
                explanation: 'O(log n) grows the slowest. For an input of 1,000,000 elements, log n is about 20 — extraordinarily efficient. The ranking from fastest to slowest growth is: O(log n) < O(n) < O(n log n) < O(n^2). This is why binary search (O(log n)) is so much faster than linear search (O(n)).',
              },
            ],
          },
        ],
      },
      // MODULE 8: Financial Math
      {
        id: 'financial-math',
        title: 'Financial Math',
        subtitle: 'Money math to blockchains',
        description: 'Master the math of money — from compound interest and investing to the mathematical foundations of cryptocurrency.',
        icon: 'dollar',
        color: '#6366f1',
        difficulty: 'beginner',
        ageRange: 'all',
        badgeId: 'badge-financial-math',
        badgeName: 'Money Mathematician',
        lessons: [
          {
            id: 'compound-interest',
            title: 'Compound Interest',
            subtitle: 'The eighth wonder of the world',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Simple vs Compound Interest',
                content: 'Simple interest earns the same amount each period on the original amount. Compound interest earns interest on your interest — the amount grows exponentially. Albert Einstein reportedly called compound interest the "eighth wonder of the world." If you invest $1,000 at 7% annual return, simple interest gives you $1,700 after 10 years. Compound interest gives you $1,967. After 40 years: $3,800 vs $14,974.',
                bulletPoints: [
                  'Simple: Interest = Principal x Rate x Time',
                  'Compound: Amount = Principal x (1 + Rate)^Time',
                  'Compounding frequency matters: daily > monthly > annually',
                  'The Rule of 72: divide 72 by the interest rate to estimate doubling time',
                  'At 7%, money doubles in about 10 years (72/7 ≈ 10)',
                ],
              },
              {
                type: 'explore',
                title: 'The Power of Starting Early',
                content: 'Imagine two people: Alex invests $200/month from age 15 to 25 (10 years, $24,000 total) then stops. Jordan invests $200/month from age 25 to 65 (40 years, $96,000 total). At 7% annual return, Alex ends up with MORE money at 65 than Jordan — despite investing 4 times less. This is because Alex\'s money had decades more time to compound. Starting early is more powerful than investing more.',
              },
              {
                type: 'challenge',
                title: 'Calculate Your Future',
                content: 'If you saved $50 per month starting today with a 7% annual return, how much would you have at age 65? Use the compound interest formula or an online calculator. Now calculate what happens if you wait 10 years to start. The difference will shock you — and motivate you to understand the math of money early.',
              },
              {
                type: 'reflect',
                title: 'Compound Interest Works Both Ways',
                content: 'Compound interest is wonderful when it works for you (savings and investments) but devastating when it works against you (debt). Credit card interest compounds too — a $1,000 balance at 20% APR becomes over $6,000 in 10 years if unpaid. Understanding this math is essential for making smart financial decisions.',
              },
            ],
            quiz: [
              {
                id: 'q-ci-1',
                question: 'Using the Rule of 72, approximately how long does it take to double your money at 6% annual return?',
                options: [
                  '6 years',
                  '12 years',
                  '18 years',
                  '72 years',
                ],
                correctIndex: 1,
                explanation: 'The Rule of 72 says: doubling time ≈ 72 / interest rate. At 6%: 72/6 = 12 years. This quick mental math is remarkably accurate for typical interest rates and helps you understand the impact of different returns.',
              },
              {
                id: 'q-ci-2',
                question: 'Why does starting to invest earlier matter so much?',
                options: [
                  'Because banks give better rates to younger people',
                  'Because compound interest means money invested earlier has more time to grow exponentially',
                  'Because inflation only affects older people',
                  'Because investment laws require a minimum age',
                ],
                correctIndex: 1,
                explanation: 'The power of compound interest increases dramatically with time. Money invested earlier generates returns that themselves generate returns, creating exponential growth. An extra decade of compounding can make a bigger difference than investing much larger amounts later.',
              },
              {
                id: 'q-ci-3',
                question: 'What is the key difference between simple and compound interest?',
                options: [
                  'Simple interest is higher than compound interest',
                  'Compound interest earns interest on previously earned interest; simple interest only earns on the original principal',
                  'Simple interest is only for savings; compound interest is only for loans',
                  'There is no real difference — they are different names for the same thing',
                ],
                correctIndex: 1,
                explanation: 'With simple interest, you earn the same fixed amount each period based on the original principal. With compound interest, earned interest is added to the principal, so future interest is calculated on a growing balance. This "interest on interest" creates exponential growth.',
              },
            ],
          },
          {
            id: 'budgeting-investing',
            title: 'Budgeting & Investing',
            subtitle: 'Making your money work',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'The 50/30/20 Rule',
                content: 'A simple budgeting framework: 50% of income for needs (rent, food, utilities), 30% for wants (entertainment, dining out), and 20% for savings and debt repayment. This is a starting point, not a rigid rule. The key insight is that managing money is about intentional allocation — deciding in advance where your money goes instead of wondering where it went.',
                bulletPoints: [
                  '50% Needs: housing, food, transportation, insurance',
                  '30% Wants: entertainment, hobbies, dining, subscriptions',
                  '20% Savings: emergency fund, investments, debt payoff',
                  'Pay yourself first: save before spending on wants',
                  'Track spending to identify where money actually goes',
                ],
              },
              {
                type: 'explore',
                title: 'Investment Basics',
                content: 'Investing means putting money into assets that you expect to grow in value over time. Stocks represent ownership in companies. Bonds are loans to governments or companies. Index funds hold many stocks to spread risk. The fundamental trade-off is risk versus return — higher potential returns come with higher risk. Diversification (spreading investments across many assets) reduces risk without necessarily reducing returns.',
              },
              {
                type: 'challenge',
                title: 'Build a Mock Portfolio',
                content: 'You have $10,000 to invest. Research and allocate it across at least 4 different types of investments (stocks, bonds, index funds, savings account). Explain why you chose each allocation. Look up the historical returns for each type and calculate what your portfolio would be worth in 20 years. Compare your strategy to putting everything in one investment.',
              },
              {
                type: 'reflect',
                title: 'Financial Literacy Is Power',
                content: 'Financial literacy is one of the most practically impactful things you can learn. Understanding budgeting, compound interest, and investing gives you control over your financial future. Many wealthy people got there not through high income but through consistent saving, smart investing, and understanding the math of money.',
              },
            ],
            quiz: [
              {
                id: 'q-bi-1',
                question: 'In the 50/30/20 budgeting rule, what does the 20% represent?',
                options: [
                  'Taxes',
                  'Entertainment and wants',
                  'Savings and debt repayment',
                  'Food and housing',
                ],
                correctIndex: 2,
                explanation: 'In the 50/30/20 framework, 20% is allocated to savings and debt repayment. This includes building an emergency fund, investing for the future, and paying off any debts beyond minimum payments.',
              },
              {
                id: 'q-bi-2',
                question: 'What is diversification in investing?',
                options: [
                  'Investing all your money in the most diverse company',
                  'Spreading investments across different assets to reduce risk',
                  'Changing your investments every day',
                  'Only investing in foreign companies',
                ],
                correctIndex: 1,
                explanation: 'Diversification means spreading your money across different types of investments (stocks, bonds, real estate, etc.) and different companies/sectors. If one investment performs poorly, others may perform well, reducing your overall risk.',
              },
              {
                id: 'q-bi-3',
                question: 'What is the fundamental trade-off in investing?',
                options: [
                  'Time vs money',
                  'Risk vs return — higher potential returns typically come with higher risk',
                  'Buying vs selling',
                  'Domestic vs international investments',
                ],
                correctIndex: 1,
                explanation: 'The risk-return trade-off is the fundamental principle of investing. Safer investments (like government bonds) offer lower returns, while riskier investments (like individual stocks) offer higher potential returns but also higher potential losses.',
              },
            ],
          },
          {
            id: 'crypto-math',
            title: 'Crypto Math Basics',
            subtitle: 'The mathematics behind cryptocurrency',
            xpReward: 50,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Cryptographic Hash Functions',
                content: 'A hash function takes any input and produces a fixed-size output (hash) that appears random. The same input always produces the same hash, but even a tiny change in input produces a completely different hash. It is practically impossible to reverse — you cannot figure out the input from the hash. This one-way property is the mathematical foundation of blockchain security and cryptocurrency.',
                bulletPoints: [
                  'Deterministic: same input always gives same output',
                  'Fixed size: output is always the same length regardless of input size',
                  'Avalanche effect: tiny input changes cause dramatically different outputs',
                  'One-way: practically impossible to reverse',
                  'Collision resistant: extremely hard to find two inputs with the same hash',
                ],
              },
              {
                type: 'explore',
                title: 'How Blockchain Works',
                content: 'A blockchain is a chain of blocks, each containing transaction data and the hash of the previous block. This creates a tamper-proof chain — changing any block changes its hash, which invalidates every subsequent block. Miners compete to find a special hash (proof of work) by trying billions of random values. The math ensures that forging the blockchain would require more computing power than exists on Earth.',
              },
              {
                type: 'challenge',
                title: 'Hash It Out',
                content: 'Use an online SHA-256 hash calculator. Hash the word "hello" and note the output. Then hash "Hello" (capital H) and compare. The outputs look completely different despite a single character change — this is the avalanche effect. Now try to find an input that produces a hash starting with "000." This difficulty is what makes mining computationally expensive.',
              },
              {
                type: 'reflect',
                title: 'Math Secures the Digital World',
                content: 'The security of cryptocurrency, online banking, encrypted messaging, and digital signatures all rely on mathematical properties of hash functions and number theory. The math is not just theoretical — it protects billions of dollars and billions of communications every day. Understanding this math helps you make informed decisions about digital security and cryptocurrency.',
              },
            ],
            quiz: [
              {
                id: 'q-cm-1',
                question: 'What is a key property of cryptographic hash functions?',
                options: [
                  'They can be easily reversed to find the original input',
                  'They are one-way: you cannot determine the input from the output',
                  'They always produce different outputs for the same input',
                  'They only work with numerical data',
                ],
                correctIndex: 1,
                explanation: 'Cryptographic hash functions are designed to be one-way — given a hash output, it is computationally infeasible to determine what input produced it. This property is essential for security applications like password storage and blockchain integrity.',
              },
              {
                id: 'q-cm-2',
                question: 'What makes a blockchain tamper-proof?',
                options: [
                  'Each block is protected by a password',
                  'Each block contains the hash of the previous block, so changing one block invalidates the entire chain',
                  'Blockchain data is stored on government servers',
                  'Only one person can access the blockchain at a time',
                ],
                correctIndex: 1,
                explanation: 'Each block contains the hash of the previous block. If someone changes data in any block, its hash changes, which breaks the link to the next block. To forge the chain, an attacker would need to recompute hashes for every subsequent block faster than the entire network — a practically impossible task.',
              },
              {
                id: 'q-cm-3',
                question: 'What is the "avalanche effect" in hash functions?',
                options: [
                  'Hash functions get slower over time',
                  'A tiny change in the input produces a completely different output hash',
                  'Multiple inputs can produce the same hash',
                  'Hash outputs grow larger as inputs get bigger',
                ],
                correctIndex: 1,
                explanation: 'The avalanche effect means that even a minimal change to the input (like changing one character) causes the output hash to change dramatically. This makes it impossible to predict how an input modification will affect the hash, which is crucial for security.',
              },
            ],
          },
          {
            id: 'risk-expected-value',
            title: 'Risk & Expected Value',
            subtitle: 'Making smart bets with your money',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Risk Assessment',
                content: 'Risk in finance is the possibility that an investment\'s actual return differs from the expected return. Variance and standard deviation measure how spread out returns are — higher spread means higher risk. A stock that might return -20% to +40% is riskier than a bond that returns 3-5%. Understanding risk mathematically helps you make decisions that match your risk tolerance.',
                bulletPoints: [
                  'Risk = uncertainty about future returns',
                  'Standard deviation measures how spread out returns are',
                  'Higher risk means higher potential returns AND losses',
                  'Risk tolerance varies by person, age, and financial situation',
                  'Never risk money you cannot afford to lose',
                ],
              },
              {
                type: 'explore',
                title: 'Expected Value in Finance',
                content: 'Expected value helps evaluate financial decisions. If a stock has a 60% chance of gaining 20% and a 40% chance of losing 10%, the expected return is (0.6 x 20%) + (0.4 x -10%) = 8%. But expected value alone is not enough — two investments with the same expected value can have very different risk profiles. A guaranteed 8% return is very different from a coin flip between +100% and -84%.',
              },
              {
                type: 'challenge',
                title: 'Evaluate Investment Options',
                content: 'Compare three investments: (A) 100% chance of 5% return, (B) 70% chance of 15% return and 30% chance of -5% return, (C) 50% chance of 30% return and 50% chance of -10% return. Calculate the expected value for each. Which would you choose and why? Your answer reveals your risk tolerance.',
              },
              {
                type: 'reflect',
                title: 'Rationality and Risk',
                content: 'Humans are not naturally good at evaluating risk. We overestimate rare dramatic risks (plane crashes) and underestimate common gradual ones (heart disease). We feel losses more strongly than equivalent gains. Understanding these biases, combined with the math of expected value and risk, helps you make more rational financial decisions.',
              },
            ],
            quiz: [
              {
                id: 'q-rev-1',
                question: 'What does standard deviation measure in a financial context?',
                options: [
                  'The average return of an investment',
                  'How spread out investment returns are — higher values mean more risk',
                  'The minimum possible return',
                  'The maximum possible return',
                ],
                correctIndex: 1,
                explanation: 'Standard deviation measures the spread of returns around the average. A higher standard deviation means returns are more spread out (more volatile), indicating higher risk. A lower standard deviation means returns are more predictable.',
              },
              {
                id: 'q-rev-2',
                question: 'An investment has a 70% chance of returning +10% and a 30% chance of returning -5%. What is the expected return?',
                options: [
                  '5%',
                  '5.5%',
                  '7%',
                  '3.5%',
                ],
                correctIndex: 1,
                explanation: 'Expected return = (0.70 x 10%) + (0.30 x -5%) = 7% + (-1.5%) = 5.5%. This weighted average accounts for both the probability and magnitude of each possible outcome.',
              },
              {
                id: 'q-rev-3',
                question: 'Why is expected value alone not sufficient for making investment decisions?',
                options: [
                  'Because expected value is always wrong',
                  'Because two investments with the same expected value can have very different risk levels',
                  'Because expected value does not work for financial data',
                  'Because only professional investors can calculate expected value',
                ],
                correctIndex: 1,
                explanation: 'Expected value tells you the average outcome but not the range of possible outcomes. A guaranteed 5% return and a 50/50 chance of +100%/-90% might have similar expected values, but they have vastly different risk profiles. You need both expected value and risk measures to make informed decisions.',
              },
            ],
          },
        ],
      },
    ],
  },
  // =====================================================================
  // TRACK 3: CRITICAL THINKING
  // =====================================================================
  {
    id: 'critical-thinking',
    title: 'Critical Thinking',
    subtitle: 'Think clearly in a complex world',
    description: 'Develop the reasoning, empathy, and analytical skills to navigate misinformation, evaluate AI systems, and make ethical decisions.',
    icon: 'CT',
    color: '#f59e0b',
    modules: [
      // MODULE 1: Think Like a Detective
      {
        id: 'foundations',
        title: 'Think Like a Detective',
        subtitle: 'Questioning everything',
        description: 'Build the foundations of critical thinking — distinguishing facts from opinions, recognizing logical fallacies, and asking better questions.',
        icon: 'search',
        color: '#f59e0b',
        difficulty: 'beginner',
        ageRange: '10-12',
        badgeId: 'badge-foundations',
        badgeName: 'Truth Seeker',
        lessons: [
          {
            id: 'facts-vs-opinions',
            title: 'Facts vs Opinions',
            subtitle: 'Telling them apart is harder than you think',
            xpReward: 50,
            durationMinutes: 10,
            sections: [
              {
                type: 'learn',
                title: 'What Makes a Fact?',
                content: 'A fact is a statement that can be verified as true or false through evidence and observation. "Water boils at 100 degrees Celsius at sea level" is a fact — you can test it. An opinion is a personal belief or judgment that cannot be proven. "Chocolate is the best flavor" is an opinion. The tricky part: many statements are presented as facts when they are actually opinions, and vice versa.',
                bulletPoints: [
                  'Facts: verifiable through evidence, observation, or measurement',
                  'Opinions: personal beliefs, preferences, or judgments',
                  'Informed opinions: based on evidence but still subjective',
                  'Disguised opinions: statements that sound factual but cannot be verified',
                  'Context matters: "This is the best school" is opinion; "This school has the highest test scores" is verifiable',
                ],
              },
              {
                type: 'explore',
                title: 'The Gray Area',
                content: 'Real-world statements often blend facts and opinions. "Climate change is the biggest threat to humanity" combines a scientific fact (climate change exists) with an opinion (it is the "biggest" threat — compared to what?). Learning to untangle the factual and opinion components of complex statements is a crucial critical thinking skill.',
              },
              {
                type: 'challenge',
                title: 'Sort the Statements',
                content: 'Classify each statement as fact, opinion, or mixed: (1) "The Earth orbits the Sun." (2) "Dogs are better pets than cats." (3) "The US has the largest economy in the world." (4) "Everyone should learn to code." (5) "AI will take over all jobs." Practice identifying what makes each one verifiable or subjective.',
              },
              {
                type: 'reflect',
                title: 'Why This Matters Now',
                content: 'In the age of AI-generated content and social media, the line between fact and opinion is more blurred than ever. AI can generate authoritative-sounding text that mixes facts with unsupported claims. Developing the habit of asking "Is this verifiable?" before accepting any statement is your best defense against misinformation.',
              },
            ],
            quiz: [
              {
                id: 'q-fvo-1',
                question: 'Which of the following is a FACT?',
                options: [
                  'Pizza is the best food in the world',
                  'Mount Everest is the tallest mountain above sea level',
                  'Summer is the best season',
                  'AI is scary',
                ],
                correctIndex: 1,
                explanation: 'The height of Mount Everest can be measured and verified objectively. The other statements are opinions — they express personal preferences or emotional reactions that cannot be proven true or false through evidence.',
              },
              {
                id: 'q-fvo-2',
                question: 'What is a "disguised opinion"?',
                options: [
                  'An opinion that is written in a different language',
                  'A statement that sounds like a fact but is actually a subjective judgment',
                  'A fact that people disagree about',
                  'An opinion that nobody has ever heard before',
                ],
                correctIndex: 1,
                explanation: 'A disguised opinion is a subjective statement presented in a way that makes it sound factual. "This is the most important issue of our time" sounds authoritative but is actually a judgment. Recognizing disguised opinions is crucial for critical evaluation of media and arguments.',
              },
              {
                id: 'q-fvo-3',
                question: 'Why is distinguishing facts from opinions especially important in the AI age?',
                options: [
                  'Because AI only produces opinions, never facts',
                  'Because AI can generate authoritative-sounding text that mixes facts with unsupported claims',
                  'Because opinions are becoming illegal',
                  'Because AI does not understand the difference between facts and opinions',
                ],
                correctIndex: 1,
                explanation: 'AI can produce fluent, confident text that seamlessly blends verifiable facts with unsupported claims, hallucinated information, or embedded opinions. This makes it more important than ever to critically evaluate whether statements are supported by evidence.',
              },
            ],
          },
          {
            id: 'logical-fallacies',
            title: 'Logical Fallacies',
            subtitle: 'Spotting broken arguments',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Common Logical Fallacies',
                content: 'A logical fallacy is an error in reasoning that makes an argument invalid. They are everywhere — in advertising, politics, social media debates, and even school discussions. Recognizing fallacies helps you evaluate arguments critically instead of being persuaded by flawed logic. Here are the most common ones you will encounter.',
                bulletPoints: [
                  'Ad Hominem: attacking the person instead of their argument',
                  'Straw Man: misrepresenting someone\'s argument to make it easier to attack',
                  'Appeal to Authority: claiming something is true because an authority figure said so',
                  'False Dilemma: presenting only two options when more exist',
                  'Bandwagon: arguing something is true because many people believe it',
                ],
              },
              {
                type: 'explore',
                title: 'Fallacies in the Wild',
                content: 'Social media is a fallacy minefield. "You can\'t trust their opinion on climate change — they\'re not even a scientist" (ad hominem — non-scientists can still cite scientific evidence). "Either you support total internet freedom or you support censorship" (false dilemma — there are many positions between these extremes). Once you learn to spot fallacies, you will see them everywhere.',
              },
              {
                type: 'challenge',
                title: 'Fallacy Detective',
                content: 'Find three arguments online (in comments, ads, or opinion pieces) that contain logical fallacies. For each one, identify the fallacy, explain why the reasoning is flawed, and rewrite the argument without the fallacy. Notice how the argument becomes weaker or needs additional evidence when the fallacy is removed.',
              },
              {
                type: 'reflect',
                title: 'Check Your Own Reasoning',
                content: 'The most powerful application of fallacy knowledge is catching your own flawed reasoning. We all use fallacies — it is human nature to take shortcuts in thinking. The goal is not to never commit a fallacy but to develop the self-awareness to catch yourself and think more carefully when it matters.',
              },
            ],
            quiz: [
              {
                id: 'q-lf-1',
                question: '"You can\'t trust Jake\'s opinion on healthy eating — he\'s overweight." What fallacy is this?',
                options: [
                  'False dilemma',
                  'Ad hominem',
                  'Straw man',
                  'Bandwagon',
                ],
                correctIndex: 1,
                explanation: 'This is ad hominem — attacking the person (Jake\'s weight) instead of addressing the content of his argument about healthy eating. A person\'s physical characteristics do not determine whether their argument is logically sound or supported by evidence.',
              },
              {
                id: 'q-lf-2',
                question: '"Everyone is buying this product, so it must be good." What fallacy is this?',
                options: [
                  'Appeal to authority',
                  'Straw man',
                  'Bandwagon (appeal to popularity)',
                  'False dilemma',
                ],
                correctIndex: 2,
                explanation: 'This is the bandwagon fallacy (also called appeal to popularity). The fact that many people do something does not make it good or correct. Many people once believed the Earth was flat — popularity does not determine truth.',
              },
              {
                id: 'q-lf-3',
                question: '"Either we ban AI completely or we let it destroy society." What fallacy is this?',
                options: [
                  'Ad hominem',
                  'False dilemma',
                  'Appeal to authority',
                  'Straw man',
                ],
                correctIndex: 1,
                explanation: 'This is a false dilemma — presenting only two extreme options when many middle-ground positions exist (like regulated AI development, AI safety research, gradual adoption with oversight, etc.). Real issues rarely have only two possible responses.',
              },
            ],
          },
          {
            id: 'asking-better-questions',
            title: 'Asking Better Questions',
            subtitle: 'The skill that unlocks everything else',
            xpReward: 50,
            durationMinutes: 10,
            sections: [
              {
                type: 'learn',
                title: 'The Power of Questions',
                content: 'The quality of your thinking is determined by the quality of your questions. "Why is the sky blue?" leads to physics. "Who decided that?" leads to history and power dynamics. "What would happen if...?" leads to creative thinking. The best thinkers are not those with the most answers but those who ask the most penetrating questions.',
                bulletPoints: [
                  'Closed questions have short, definitive answers (What year...? How many...?)',
                  'Open questions invite exploration and analysis (Why...? How might...? What if...?)',
                  'Probing questions dig deeper (What evidence supports that? What assumptions are we making?)',
                  'Socratic questions challenge beliefs (How do you know that? Could you be wrong?)',
                ],
              },
              {
                type: 'explore',
                title: 'The 5 Whys Technique',
                content: 'The 5 Whys technique digs to the root cause of any problem by asking "why?" five times. Surface answer: "The website is slow." Why? "The server is overloaded." Why? "Too many users at once." Why? "We did not plan for peak traffic." Why? "We did not analyze usage patterns." Why? "We did not have a monitoring system." Now you have found the root cause — and the real solution.',
              },
              {
                type: 'challenge',
                title: 'Question Everything',
                content: 'Pick a commonly accepted belief (e.g., "homework helps students learn" or "social media is bad for teens"). Write 10 questions that challenge or explore this belief from different angles. Include questions about evidence, assumptions, alternatives, and consequences. See how questioning transforms a simple belief into a complex, nuanced topic.',
              },
              {
                type: 'connect',
                title: 'Questions and AI',
                content: 'The rise of AI makes good questioning even more valuable. Anyone can get AI to generate an answer, but the quality of the answer depends entirely on the quality of the question. The skill of formulating precise, thoughtful questions — whether for a teacher, a search engine, or an AI — is one of the most transferable and valuable abilities you can develop.',
              },
            ],
            quiz: [
              {
                id: 'q-abq-1',
                question: 'Which type of question is MOST useful for deep analysis?',
                options: [
                  'Closed questions with yes/no answers',
                  'Questions that can be answered with a single number',
                  'Open-ended probing questions that explore "why" and "how"',
                  'Questions with obvious answers',
                ],
                correctIndex: 2,
                explanation: 'Open-ended probing questions like "Why does this happen?" and "How might this be different?" invite deep analysis and exploration. They require reasoning and evidence rather than simple recall, making them the most powerful tools for critical thinking.',
              },
              {
                id: 'q-abq-2',
                question: 'What is the purpose of the "5 Whys" technique?',
                options: [
                  'To ask exactly five questions about any topic',
                  'To dig past surface symptoms to find the root cause of a problem',
                  'To annoy people by constantly asking why',
                  'To write a five-paragraph essay',
                ],
                correctIndex: 1,
                explanation: 'The 5 Whys technique works by repeatedly asking "why?" to peel back layers of symptoms until you reach the fundamental root cause. Each "why?" moves you deeper past surface explanations toward the underlying issue that, if fixed, would prevent the problem from recurring.',
              },
              {
                id: 'q-abq-3',
                question: 'Why is asking good questions ESPECIALLY valuable in the AI age?',
                options: [
                  'Because AI cannot answer bad questions',
                  'Because the quality of AI-generated answers depends on the quality of the questions asked',
                  'Because questions are more expensive than answers',
                  'Because AI will eventually replace all human questions',
                ],
                correctIndex: 1,
                explanation: 'In the AI age, generating answers is easy — AI can produce fluent responses to almost any prompt. The differentiating skill is formulating the right questions. Better questions lead to better AI outputs, deeper analysis, and more useful insights.',
              },
            ],
          },
        ],
      },
      // MODULE 2: Media Literacy
      {
        id: 'media-literacy',
        title: 'Media Literacy',
        subtitle: 'Don\'t believe everything you scroll',
        description: 'Develop the skills to evaluate online information, escape filter bubbles, and fact-check claims in the age of algorithmic content.',
        icon: 'shield',
        color: '#f59e0b',
        difficulty: 'beginner',
        ageRange: '12-14',
        badgeId: 'badge-media-literacy',
        badgeName: 'Media Guardian',
        lessons: [
          {
            id: 'sift-method',
            title: 'The SIFT Method',
            subtitle: 'A fast framework for evaluating online claims',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Introducing SIFT',
                content: 'SIFT is a quick method for evaluating online information, developed by digital literacy expert Mike Caulfield. S — Stop (pause before sharing or believing). I — Investigate the source (who published this?). F — Find better coverage (what do other reliable sources say?). T — Trace claims (where did this information originate?). SIFT takes seconds and prevents the spread of misinformation.',
                bulletPoints: [
                  'S — Stop: do not react immediately; pause and think',
                  'I — Investigate the source: who created this? Are they credible?',
                  'F — Find better coverage: search for the same claim from other sources',
                  'T — Trace claims: find the original source of the information',
                ],
              },
              {
                type: 'explore',
                title: 'SIFT in Action',
                content: 'You see a shocking headline: "Scientists discover that [food] causes cancer." SIFT response: Stop — do not share yet. Investigate — who published this? Is it a known news source or an unknown blog? Find better coverage — do reputable science outlets report the same finding? Trace — what is the actual study, and does it say what the headline claims? Often, the original study is far less dramatic than the headline.',
              },
              {
                type: 'challenge',
                title: 'SIFT Challenge',
                content: 'Find three claims circulating on social media or news sites. Apply the full SIFT method to each. Document your process: what did you find when you investigated the source? Did other outlets confirm the claim? Could you trace it to an original source? Rate each claim as likely true, uncertain, or likely false based on your investigation.',
              },
              {
                type: 'connect',
                title: 'Teaching Others',
                content: 'One of the most impactful things you can do is teach SIFT to friends and family. Misinformation spreads because people share without checking. If everyone paused and applied SIFT before sharing, the spread of false information would slow dramatically. Be the person in your circle who says "let me check that first."',
              },
            ],
            quiz: [
              {
                id: 'q-sm-1',
                question: 'What is the first step of SIFT?',
                options: [
                  'Share the content quickly',
                  'Stop — pause before reacting or sharing',
                  'Search for the author',
                  'Find similar articles',
                ],
                correctIndex: 1,
                explanation: 'The first step is Stop. When you encounter a claim that triggers an emotional reaction (surprise, anger, fear), pause before sharing or believing it. Emotional reactions bypass critical thinking, which is exactly what misinformation exploits.',
              },
              {
                id: 'q-sm-2',
                question: 'What does "Trace claims" mean in SIFT?',
                options: [
                  'Drawing the claim on paper',
                  'Finding the original source where the information originated',
                  'Tracing the letters of the claim',
                  'Sending the claim to a fact-checker',
                ],
                correctIndex: 1,
                explanation: 'Tracing claims means going upstream to find the original source of the information. Headlines and social media posts often distort or exaggerate the original source. By finding the original study, report, or statement, you can evaluate whether the claim accurately represents the source material.',
              },
              {
                id: 'q-sm-3',
                question: 'Why is SIFT especially important in the age of AI-generated content?',
                options: [
                  'Because AI content is always false',
                  'Because AI can generate convincing but fabricated content at massive scale, making verification essential',
                  'Because SIFT was designed specifically for AI content',
                  'Because AI will automatically apply SIFT for you',
                ],
                correctIndex: 1,
                explanation: 'AI can generate convincing articles, images, and even video that are completely fabricated. The volume and quality of potential misinformation has increased dramatically. SIFT provides a systematic approach to verification that remains effective regardless of how the content was created.',
              },
            ],
          },
          {
            id: 'filter-bubbles',
            title: 'Filter Bubbles & Algorithms',
            subtitle: 'When algorithms choose what you see',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'What Are Filter Bubbles?',
                content: 'A filter bubble is the intellectual isolation that occurs when algorithms show you only content that matches your existing interests and beliefs. Social media algorithms learn what you engage with and show you more of the same. Over time, you see an increasingly narrow slice of information and perspectives, creating the illusion that everyone thinks like you do.',
                bulletPoints: [
                  'Algorithms prioritize content you are likely to engage with',
                  'Engagement-driven curation reinforces existing beliefs',
                  'Different people see very different versions of reality online',
                  'Echo chambers: communities where only one viewpoint is expressed',
                  'Filter bubbles are invisible — you do not realize what you are NOT seeing',
                ],
              },
              {
                type: 'explore',
                title: 'How Recommendation Algorithms Work',
                content: 'Recommendation algorithms optimize for engagement — clicks, likes, comments, and time spent. Content that triggers strong emotions (especially outrage and fear) generates more engagement. This means algorithms naturally amplify extreme, divisive, and emotionally provocative content while burying nuanced, moderate perspectives. Understanding this incentive structure explains much of what we see online.',
              },
              {
                type: 'challenge',
                title: 'Burst Your Bubble',
                content: 'Actively seek out a high-quality source that represents a viewpoint different from your own on a topic you care about. Read or watch the entire piece with genuine curiosity. Write down three points they make that you had not considered before. This exercise is not about changing your mind — it is about understanding that thoughtful people can reach different conclusions.',
              },
              {
                type: 'reflect',
                title: 'Curating Your Information Diet',
                content: 'You curate what you eat for physical health. You should also curate what information you consume for intellectual health. Deliberately follow sources from different perspectives. Use algorithms to your advantage by engaging with diverse content. Recognize when you are only seeing one side of a story. Your information diet shapes your worldview.',
              },
            ],
            quiz: [
              {
                id: 'q-fb-1',
                question: 'What is a filter bubble?',
                options: [
                  'A type of water purification system',
                  'The intellectual isolation created when algorithms show you only content matching your existing interests',
                  'A social media privacy setting',
                  'A spam filter for your email',
                ],
                correctIndex: 1,
                explanation: 'A filter bubble is the personalized information environment created by algorithms that show you content aligned with your existing interests, behaviors, and beliefs. Over time, this narrows the range of perspectives and information you encounter.',
              },
              {
                id: 'q-fb-2',
                question: 'Why do recommendation algorithms tend to amplify extreme content?',
                options: [
                  'Because programmers design them to be extreme',
                  'Because extreme content generates more engagement (clicks, comments, shares), and algorithms optimize for engagement',
                  'Because extreme content is more factually accurate',
                  'Because users specifically request extreme content',
                ],
                correctIndex: 1,
                explanation: 'Recommendation algorithms are optimized for engagement metrics. Content that triggers strong emotional reactions (outrage, fear, surprise) generates more clicks, comments, and shares than nuanced, moderate content. This creates a structural incentive to amplify emotionally provocative material.',
              },
              {
                id: 'q-fb-3',
                question: 'What is the best way to counteract filter bubbles?',
                options: [
                  'Stop using the internet entirely',
                  'Deliberately seek out diverse sources and perspectives to broaden your information diet',
                  'Only read content you disagree with',
                  'Trust that algorithms show you everything you need to see',
                ],
                correctIndex: 1,
                explanation: 'The most effective approach is intentionally diversifying your information sources. Follow credible outlets from different perspectives, engage with varied content, and regularly seek out viewpoints different from your own. This does not mean accepting all views as equally valid, but understanding the full landscape of perspectives.',
              },
            ],
          },
          {
            id: 'fact-checking-skills',
            title: 'Fact-Checking Skills',
            subtitle: 'Becoming your own fact-checker',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Lateral Reading',
                content: 'Professional fact-checkers use a technique called lateral reading: instead of deeply reading the source itself, they quickly open new tabs to learn about the source from other websites. They ask: What do others say about this publisher? Is this claim reported by multiple credible outlets? Does the original source support the claim being made? This is faster and more reliable than trying to evaluate a source in isolation.',
                bulletPoints: [
                  'Open new tabs to research the source, not just the content',
                  'Check what independent sources say about the publisher',
                  'Look for the same claim in multiple credible outlets',
                  'Trace claims back to their primary source',
                  'This takes 30-90 seconds and is highly effective',
                ],
              },
              {
                type: 'explore',
                title: 'Red Flags for Misinformation',
                content: 'Watch for these warning signs: emotionally charged language designed to provoke outrage, no specific sources or citations, claims that seem too good (or too terrible) to be true, pressure to share immediately ("share before they take this down!"), anonymous or unclear authorship, and URLs that mimic known news sites but are slightly different.',
              },
              {
                type: 'challenge',
                title: 'Fact-Check a Viral Claim',
                content: 'Find a claim that is widely shared on social media. Apply lateral reading to investigate it. Check fact-checking sites like Snopes, PolitiFact, or FactCheck.org. Compare the original claim to what you find. Write a brief fact-check report: the claim, your findings, your sources, and your verdict (true, partially true, misleading, or false).',
              },
              {
                type: 'reflect',
                title: 'The Responsibility of Sharing',
                content: 'Every time you share content, you are broadcasting it to your network. Before sharing, ask: Am I confident this is accurate? Am I sharing this because it is true or because it confirms what I already believe? Could sharing this cause harm if it turns out to be wrong? Taking responsibility for what you share is a form of digital citizenship.',
              },
            ],
            quiz: [
              {
                id: 'q-fcs-1',
                question: 'What is "lateral reading"?',
                options: [
                  'Reading a webpage from left to right',
                  'Researching a source by opening new tabs to see what others say about it, rather than deeply reading the source itself',
                  'Reading multiple books at the same time',
                  'Reading only the left side of a webpage',
                ],
                correctIndex: 1,
                explanation: 'Lateral reading means leaving the source in question and opening new tabs to investigate what other, independent sources say about the publisher and the claims. This external verification is faster and more reliable than trying to evaluate credibility from the source alone.',
              },
              {
                id: 'q-fcs-2',
                question: 'Which is a common red flag for misinformation?',
                options: [
                  'The article cites multiple peer-reviewed studies',
                  'The article uses emotionally charged language and pressures you to share immediately',
                  'The article acknowledges limitations of its claims',
                  'The article includes quotes from multiple perspectives',
                ],
                correctIndex: 1,
                explanation: 'Emotionally manipulative language and urgency to share ("Share before they delete this!") are classic misinformation tactics. They bypass critical thinking by triggering emotional reactions. Credible sources typically present information calmly with proper sourcing and do not pressure you to share.',
              },
              {
                id: 'q-fcs-3',
                question: 'Before sharing content on social media, what should you ask yourself?',
                options: [
                  'Will this get a lot of likes?',
                  'Am I confident this is accurate, and could sharing it cause harm if wrong?',
                  'Is this funny enough to go viral?',
                  'Does this make the people I disagree with look bad?',
                ],
                correctIndex: 1,
                explanation: 'Responsible sharing means considering accuracy and potential impact. Every share amplifies content to your network. Asking "Is this verified?" and "Could this cause harm?" before sharing is a simple but powerful practice for reducing the spread of misinformation.',
              },
            ],
          },
        ],
      },
      // MODULE 3: AI Bias & Fairness
      {
        id: 'ai-bias',
        title: 'AI Bias & Fairness',
        subtitle: 'Who taught the machine?',
        description: 'Investigate how bias enters AI systems, explore competing definitions of fairness, and learn to conduct your own bias audits.',
        icon: 'balance',
        color: '#f59e0b',
        difficulty: 'intermediate',
        ageRange: '13-16',
        badgeId: 'badge-ai-bias',
        badgeName: 'Fairness Analyst',
        lessons: [
          {
            id: 'types-of-ai-bias',
            title: 'Types of AI Bias',
            subtitle: 'Many ways for things to go wrong',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'Sources of Bias',
                content: 'AI bias can enter at every stage of development. Historical bias exists in the data reflecting past discrimination. Representation bias occurs when training data does not represent all groups equally. Measurement bias happens when the thing you measure is a flawed proxy for what you actually care about. Aggregation bias occurs when one model is used for groups that should be treated differently.',
                bulletPoints: [
                  'Historical bias: data reflects past societal inequalities',
                  'Representation bias: some groups are under- or over-represented in data',
                  'Measurement bias: using flawed proxies (e.g., zip code as a proxy for race)',
                  'Aggregation bias: one-size-fits-all models that ignore group differences',
                  'Evaluation bias: testing the model on data that does not represent all users',
                ],
              },
              {
                type: 'explore',
                title: 'Bias Case Studies',
                content: 'A healthcare algorithm used healthcare spending to predict who needed extra care. Because systemic racism meant Black patients historically had less access to healthcare (and thus lower spending), the algorithm systematically underestimated their health needs. The proxy (spending) seemed neutral but was deeply correlated with race. This affected millions of patients before being caught.',
              },
              {
                type: 'challenge',
                title: 'Find the Bias',
                content: 'Imagine you are building an AI to recommend students for a gifted program. Your training data is 10 years of past recommendations from teachers. What biases might exist in this data? How might teacher bias, school funding disparities, and cultural factors affect which students were historically recommended? Propose three ways to mitigate these biases.',
              },
              {
                type: 'reflect',
                title: 'Bias Is Not Just a Technical Problem',
                content: 'AI bias is ultimately a social problem with technical dimensions. Technical fixes (better data, fairness constraints) are necessary but not sufficient. We also need diverse development teams, community input, regular audits, and accountability mechanisms. Solving AI bias requires both technical skills and social awareness.',
              },
            ],
            quiz: [
              {
                id: 'q-toab-1',
                question: 'What is "measurement bias" in AI?',
                options: [
                  'When the AI measures things too precisely',
                  'When the metric used is a flawed proxy that correlates with characteristics like race or gender',
                  'When the measuring instruments are broken',
                  'When measurements are taken at the wrong time of day',
                ],
                correctIndex: 1,
                explanation: 'Measurement bias occurs when the variable you measure is an imperfect proxy for what you actually care about, and that proxy is correlated with protected characteristics. For example, using zip code as a proxy for "risk" can inadvertently discriminate by race due to residential segregation.',
              },
              {
                id: 'q-toab-2',
                question: 'In the healthcare algorithm example, what caused the bias?',
                options: [
                  'The algorithm was intentionally designed to discriminate',
                  'The algorithm used healthcare spending as a proxy for health needs, but systemic racism meant Black patients had lower spending',
                  'The data was corrupted by hackers',
                  'The algorithm only worked for one hospital',
                ],
                correctIndex: 1,
                explanation: 'The algorithm used healthcare spending to predict who needed extra care. Because systemic racism resulted in Black patients having less access to healthcare (and thus lower spending), the algorithm interpreted their lower spending as meaning they were healthier — when in reality they were underserved.',
              },
              {
                id: 'q-toab-3',
                question: 'Why is solving AI bias not JUST a technical problem?',
                options: [
                  'Because technology cannot fix anything',
                  'Because bias originates from social inequalities that also require diverse teams, community input, and accountability mechanisms',
                  'Because AI bias does not actually exist',
                  'Because only politicians can solve bias',
                ],
                correctIndex: 1,
                explanation: 'AI bias reflects societal biases embedded in data and design choices. While technical solutions help, comprehensively addressing bias also requires diverse development teams who can spot issues, community input from affected populations, regular audits, and accountability structures.',
              },
            ],
          },
          {
            id: 'fairness-definitions',
            title: 'Fairness Definitions',
            subtitle: 'What does "fair" even mean?',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'Competing Notions of Fairness',
                content: 'Mathematicians have defined multiple formal fairness criteria, and a landmark impossibility result shows that most of them cannot all be satisfied simultaneously. This forces difficult choices about which type of fairness matters most in each context.',
                bulletPoints: [
                  'Demographic parity: equal acceptance rates across groups',
                  'Equalized odds: equal error rates across groups',
                  'Predictive parity: equal accuracy of positive predictions across groups',
                  'Individual fairness: similar people should get similar outcomes',
                  'Impossibility theorem: you generally cannot satisfy all definitions at once',
                ],
              },
              {
                type: 'explore',
                title: 'Fairness Trade-Offs',
                content: 'Consider a college admissions AI. Demographic parity means admitting the same percentage from each group. Predictive parity means admitted students from each group succeed at equal rates. Equalized odds means equal false-rejection rates. If groups have different baseline academic preparation (due to unequal school funding), these criteria pull in different directions. Choosing which fairness to prioritize is a values question, not a math question.',
              },
              {
                type: 'challenge',
                title: 'The Fairness Debate',
                content: 'A criminal justice AI predicts whether a defendant will reoffend. It has equal accuracy for all racial groups but different false positive rates — it wrongly flags Black defendants as high risk more often. Is this fair? Argue both sides: why equal accuracy might be considered fair, and why different false positive rates might be considered unfair. There is no single right answer.',
              },
              {
                type: 'reflect',
                title: 'Who Gets to Decide?',
                content: 'When different fairness criteria conflict, someone must decide which to prioritize. Currently, these decisions are usually made by engineers and company executives. But the people most affected by AI decisions — communities subject to predictive policing, applicants evaluated by hiring AI — often have no say. Who should get to decide what "fair" means for a given AI system?',
              },
            ],
            quiz: [
              {
                id: 'q-fd-1',
                question: 'What does the impossibility theorem about fairness tell us?',
                options: [
                  'That fairness is impossible to achieve',
                  'That multiple mathematical definitions of fairness generally cannot all be satisfied simultaneously',
                  'That AI can never be fair',
                  'That only one definition of fairness exists',
                ],
                correctIndex: 1,
                explanation: 'The impossibility theorem shows that except in special cases, you cannot satisfy all mathematical fairness criteria simultaneously. This means trade-offs are inevitable, and choosing which type of fairness to prioritize in each context becomes a crucial decision.',
              },
              {
                id: 'q-fd-2',
                question: 'What is "demographic parity" as a fairness criterion?',
                options: [
                  'All groups must have equal populations',
                  'The AI must accept or approve at equal rates across demographic groups',
                  'All groups must have equal income',
                  'The AI must use demographic data in its decisions',
                ],
                correctIndex: 1,
                explanation: 'Demographic parity requires that the positive outcome rate (acceptance, approval, selection) be equal across demographic groups. For example, if 30% of Group A applicants are accepted, 30% of Group B applicants should also be accepted.',
              },
              {
                id: 'q-fd-3',
                question: 'Why is choosing a fairness definition a VALUES question, not just a MATH question?',
                options: [
                  'Because math cannot calculate fairness',
                  'Because different fairness criteria can conflict, and prioritizing one over another reflects moral and social values',
                  'Because values are more important than math',
                  'Because AI does not use math for fairness',
                ],
                correctIndex: 1,
                explanation: 'When fairness criteria conflict (as the impossibility theorem shows they must), deciding which to prioritize reflects our values about what matters most. Equal accuracy? Equal false positive rates? Equal representation? These are moral choices that depend on context and the needs of affected communities.',
              },
            ],
          },
          {
            id: 'conducting-bias-audit',
            title: 'Conducting a Bias Audit',
            subtitle: 'Testing AI systems for fairness',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Is a Bias Audit?',
                content: 'A bias audit is a systematic evaluation of an AI system to check whether it produces unfair outcomes for different groups. It involves testing the system with diverse inputs, measuring outcomes across groups, identifying disparities, and investigating root causes. Bias audits are becoming required by law in some places — New York City requires bias audits of AI hiring tools.',
                bulletPoints: [
                  'Define which groups and outcomes to examine',
                  'Collect or generate test data that represents all groups',
                  'Measure the system\'s outcomes (accuracy, error rates) for each group',
                  'Compare metrics across groups to identify disparities',
                  'Investigate root causes of any disparities found',
                ],
              },
              {
                type: 'explore',
                title: 'Audit Methods',
                content: 'There are several approaches to bias auditing. Input testing varies the protected characteristic (name, photo, location) while keeping everything else the same to see if it changes the output. Outcome analysis compares real-world outcomes across groups. Red-teaming tries adversarial inputs to find failure modes. Each method reveals different types of bias.',
              },
              {
                type: 'challenge',
                title: 'Audit an AI System',
                content: 'Choose an AI tool you have access to (an image generator, a chatbot, a translation tool). Design and conduct a simple bias audit. Test it with inputs representing different demographics. Document the outputs and look for patterns of disparity. Write a brief audit report with your findings and recommendations.',
              },
              {
                type: 'connect',
                title: 'From Auditor to Advocate',
                content: 'Being able to identify bias in AI systems is a powerful skill. Companies, governments, and civil rights organizations need people who can audit AI for fairness. This is not just a career opportunity — it is a way to make technology serve everyone more equitably. The skills you are learning here have real-world impact.',
              },
            ],
            quiz: [
              {
                id: 'q-cba-1',
                question: 'What is the purpose of a bias audit?',
                options: [
                  'To prove that an AI system is perfect',
                  'To systematically evaluate whether an AI system produces unfair outcomes for different groups',
                  'To make the AI system faster',
                  'To reduce the cost of running the AI system',
                ],
                correctIndex: 1,
                explanation: 'A bias audit systematically tests whether an AI system produces different outcomes for different demographic groups and whether those differences are unfair. The goal is to identify and measure disparities so they can be investigated and addressed.',
              },
              {
                id: 'q-cba-2',
                question: 'What is "input testing" in a bias audit?',
                options: [
                  'Testing how fast the system processes input',
                  'Varying the protected characteristic (name, photo) while keeping everything else constant to see if output changes',
                  'Testing all possible inputs to the system',
                  'Asking users to rate the input quality',
                ],
                correctIndex: 1,
                explanation: 'Input testing isolates the effect of protected characteristics by changing only those attributes (like swapping names associated with different races) while keeping all other inputs identical. If the output changes, the system may be using protected characteristics in its decisions.',
              },
              {
                id: 'q-cba-3',
                question: 'Which city now requires bias audits for AI hiring tools?',
                options: [
                  'Los Angeles',
                  'London',
                  'New York City',
                  'Tokyo',
                ],
                correctIndex: 2,
                explanation: 'New York City passed Local Law 144 requiring employers to conduct independent bias audits of automated employment decision tools before using them. This is one of the first AI-specific regulations in the US and signals a growing trend toward mandatory AI auditing.',
              },
            ],
          },
        ],
      },
      // MODULE 4: Empathy & Perspective
      {
        id: 'empathy',
        title: 'Empathy & Perspective',
        subtitle: 'Walking in digital shoes',
        description: 'Develop cognitive and emotional empathy skills essential for designing inclusive technology and building meaningful connections in a digital world.',
        icon: 'heart',
        color: '#f59e0b',
        difficulty: 'beginner',
        ageRange: 'all',
        badgeId: 'badge-empathy',
        badgeName: 'Empathy Expert',
        lessons: [
          {
            id: 'cognitive-emotional-empathy',
            title: 'Cognitive vs Emotional Empathy',
            subtitle: 'Two sides of understanding others',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Two Types of Empathy',
                content: 'Cognitive empathy is understanding what someone else thinks and why — seeing the world through their mental framework. Emotional empathy is feeling what someone else feels — sharing their joy, sadness, or frustration. Both types are important, but they serve different purposes. Cognitive empathy helps you understand perspectives; emotional empathy helps you connect with people.',
                bulletPoints: [
                  'Cognitive: understanding another person\'s thoughts and reasoning',
                  'Emotional: feeling another person\'s emotions alongside them',
                  'Compassionate empathy: combining understanding with the motivation to help',
                  'You can have cognitive empathy without emotional empathy, and vice versa',
                  'Both can be developed and strengthened with practice',
                ],
              },
              {
                type: 'explore',
                title: 'Empathy in Technology',
                content: 'Tech companies increasingly recognize that empathy is essential for good design. Understanding users\' frustrations, needs, and contexts leads to better products. Empathy also helps identify potential harms — if you can imagine how a feature might affect a marginalized community, you can prevent problems before they occur. The best engineers combine technical skill with genuine empathy for users.',
              },
              {
                type: 'challenge',
                title: 'Empathy Practice',
                content: 'Think of someone you disagree with about a topic you care about. Spend 10 minutes trying to genuinely understand their perspective using cognitive empathy. What experiences might have shaped their view? What values are they prioritizing? Write down their argument as they would present it — not as a caricature, but as the strongest version. This is called "steelmanning."',
              },
              {
                type: 'reflect',
                title: 'The Empathy Muscle',
                content: 'Empathy is not a fixed trait — it is a skill that improves with practice. Research shows that reading fiction, having diverse friendships, traveling, and actively practicing perspective-taking all strengthen empathy. In a world increasingly mediated by screens, deliberately cultivating empathy is more important than ever.',
              },
            ],
            quiz: [
              {
                id: 'q-cee-1',
                question: 'What is the difference between cognitive and emotional empathy?',
                options: [
                  'Cognitive empathy is real; emotional empathy is fake',
                  'Cognitive empathy is understanding what someone thinks; emotional empathy is feeling what they feel',
                  'Cognitive empathy is for smart people; emotional empathy is for everyone else',
                  'There is no difference — they are the same thing',
                ],
                correctIndex: 1,
                explanation: 'Cognitive empathy is intellectual — understanding another person\'s perspective, reasoning, and viewpoint. Emotional empathy is felt — actually experiencing emotions similar to what someone else is feeling. Both are valuable and serve different purposes.',
              },
              {
                id: 'q-cee-2',
                question: 'Why is empathy important in technology design?',
                options: [
                  'It is not — technology is purely technical',
                  'Because understanding users\' needs, frustrations, and contexts leads to better products and helps prevent harm',
                  'Because empathetic software runs faster',
                  'Because government regulations require empathy in technology',
                ],
                correctIndex: 1,
                explanation: 'Empathy helps designers and engineers understand how real people (with diverse backgrounds, abilities, and needs) will experience technology. It leads to more useful, accessible products and helps identify potential harms to vulnerable users before launch.',
              },
              {
                id: 'q-cee-3',
                question: 'What does research show about empathy as a skill?',
                options: [
                  'You are born with a fixed level of empathy that never changes',
                  'Empathy can only decrease with age',
                  'Empathy is a skill that can be strengthened through practice, reading fiction, and diverse social interactions',
                  'Only some people are capable of empathy',
                ],
                correctIndex: 2,
                explanation: 'Research demonstrates that empathy is not a fixed trait but a skill that can be developed. Reading literary fiction, maintaining diverse friendships, traveling, and deliberately practicing perspective-taking all strengthen empathetic abilities over time.',
              },
            ],
          },
          {
            id: 'perspective-swap',
            title: 'The Perspective Swap',
            subtitle: 'Seeing the world through other eyes',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Why Perspectives Differ',
                content: 'Two people can look at the same situation and see completely different things. Our perspectives are shaped by our experiences, culture, education, privileges, and identities. Understanding this helps you realize that your perspective is not "the truth" — it is one valid viewpoint among many. The more perspectives you can understand, the more complete your picture of reality becomes.',
                bulletPoints: [
                  'Life experiences shape how we interpret events',
                  'Cultural background influences values and priorities',
                  'Privilege affects what problems are visible to us',
                  'No single perspective captures the full truth',
                  'Understanding multiple perspectives leads to better decisions',
                ],
              },
              {
                type: 'explore',
                title: 'The Perspective Swap Technique',
                content: 'A perspective swap involves deliberately adopting someone else\'s viewpoint for a set period of time. Choose a person with a very different life experience from yours and try to see a situation entirely through their eyes. What concerns would they have that you do not? What advantages might you have that they do not? What would they notice that you might miss?',
              },
              {
                type: 'challenge',
                title: 'AI Through Different Eyes',
                content: 'Consider AI from three different perspectives: (1) A teenager in a wealthy suburb with the latest technology. (2) A teenager in a rural area with limited internet access. (3) A teenager whose parent just lost their job to automation. Write a paragraph from each perspective about how they view AI. Notice how the same technology means very different things depending on your situation.',
              },
              {
                type: 'connect',
                title: 'Perspective in Design',
                content: 'The best technology is designed with multiple perspectives in mind. Accessibility features help people with disabilities. Multilingual support includes non-English speakers. Offline modes help people with limited connectivity. Every perspective you consider in the design process makes the final product more inclusive and useful.',
              },
            ],
            quiz: [
              {
                id: 'q-ps-ct-1',
                question: 'Why do two people sometimes interpret the same event differently?',
                options: [
                  'Because one of them is always wrong',
                  'Because perspectives are shaped by unique experiences, cultures, and identities',
                  'Because humans are naturally irrational',
                  'Because they are looking at different events',
                ],
                correctIndex: 1,
                explanation: 'Each person\'s perspective is shaped by their unique combination of experiences, cultural background, education, identities, and circumstances. These different lenses lead to genuinely different but often valid interpretations of the same situation.',
              },
              {
                id: 'q-ps-ct-2',
                question: 'What is a "perspective swap"?',
                options: [
                  'Trading opinions with a friend',
                  'Deliberately adopting another person\'s viewpoint to understand how they experience a situation',
                  'Changing your mind about everything',
                  'Disagreeing with your own beliefs',
                ],
                correctIndex: 1,
                explanation: 'A perspective swap is a deliberate exercise in seeing a situation through someone else\'s eyes. You try to understand their concerns, advantages, limitations, and feelings — not to change your own view, but to develop a more complete understanding of the situation.',
              },
              {
                id: 'q-ps-ct-3',
                question: 'How does considering multiple perspectives improve technology design?',
                options: [
                  'It makes the code more complex',
                  'It helps create more inclusive, accessible products that work well for diverse users',
                  'It slows down the development process',
                  'It is only important for marketing',
                ],
                correctIndex: 1,
                explanation: 'Considering multiple perspectives during design helps teams anticipate diverse user needs — accessibility requirements, language differences, varying connectivity, different cultural contexts. This leads to products that serve more people effectively and avoids excluding or harming users whose needs were not considered.',
              },
            ],
          },
          {
            id: 'digital-empathy',
            title: 'Digital Empathy',
            subtitle: 'Being human behind a screen',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'The Online Empathy Gap',
                content: 'Digital communication strips away many cues we use to empathize: facial expressions, tone of voice, body language, and shared physical space. This "empathy gap" makes it easier to be cruel, dismissive, or misunderstanding online. Text messages can be misread. Sarcasm does not always translate. Real people with real feelings are behind every screen name.',
                bulletPoints: [
                  'Non-verbal cues (tone, face, body) are missing in text',
                  'Anonymity can reduce accountability for hurtful behavior',
                  'Speed of online communication reduces reflection time',
                  'Algorithms amplify conflict and outrage',
                  'The online disinhibition effect: people say things online they would never say in person',
                ],
              },
              {
                type: 'explore',
                title: 'Practicing Digital Empathy',
                content: 'Before posting or replying online, pause and consider: How will this land for the person reading it? Am I interpreting their message charitably, or assuming the worst? Would I say this to their face? Digital empathy means treating online interactions with the same care and consideration you would use in person — even when anonymity tempts you otherwise.',
              },
              {
                type: 'challenge',
                title: 'Rewrite with Empathy',
                content: 'Take three examples of harsh or dismissive online comments (from forums, social media, or comment sections). Rewrite each one to make the same point but with empathy and respect. Notice how the message can be just as clear — or even clearer — without being hurtful. Being kind does not mean being weak; it means being effective.',
              },
              {
                type: 'reflect',
                title: 'The Culture You Build',
                content: 'Every comment you post, every reply you write, and every interaction you have online contributes to digital culture. You can choose to add more empathy, understanding, and thoughtfulness to the internet — or more toxicity. That choice, made millions of times by millions of people, determines what the internet feels like for everyone.',
              },
            ],
            quiz: [
              {
                id: 'q-de-1',
                question: 'What causes the "online empathy gap"?',
                options: [
                  'Slow internet connections',
                  'The absence of facial expressions, tone of voice, and body language in digital communication',
                  'People become less intelligent when using computers',
                  'Empathy only works in person and cannot apply online',
                ],
                correctIndex: 1,
                explanation: 'The online empathy gap exists because digital communication removes the non-verbal cues (facial expressions, tone, body language) that help us understand others\' emotions and respond with empathy. Without these cues, misunderstandings increase and empathetic responses decrease.',
              },
              {
                id: 'q-de-2',
                question: 'What is the "online disinhibition effect"?',
                options: [
                  'The tendency to buy more products online',
                  'The tendency to say things online that you would never say in person, due to anonymity and distance',
                  'The effect of online advertising on purchasing behavior',
                  'The tendency to spend too much time online',
                ],
                correctIndex: 1,
                explanation: 'The online disinhibition effect describes how anonymity, invisibility, and the lack of real-time social cues lead people to express things online that they would not say in face-to-face interactions. This can lead to both positive (vulnerability, honesty) and negative (cruelty, harassment) behaviors.',
              },
              {
                id: 'q-de-3',
                question: 'What is the best approach before posting a reply to someone online?',
                options: [
                  'Post as quickly as possible before you lose the thought',
                  'Pause and consider how the person will receive it and whether you would say it to their face',
                  'Make sure your response is longer than theirs',
                  'Use as many emojis as possible to convey tone',
                ],
                correctIndex: 1,
                explanation: 'Pausing before posting gives you time to consider the other person\'s perspective, check your tone, and ensure your message communicates what you intend. Asking "Would I say this to their face?" is a powerful filter for maintaining empathy in digital interactions.',
              },
            ],
          },
          {
            id: 'empathy-in-design',
            title: 'Empathy in Design',
            subtitle: 'Building technology that cares',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Empathetic Design Principles',
                content: 'Empathetic design starts by deeply understanding the people who will use your product. This means going beyond demographics to understand emotions, frustrations, capabilities, and contexts. Inclusive design ensures products work for people with different abilities, backgrounds, and situations. Universal design creates solutions that work for the widest possible range of users from the start.',
                bulletPoints: [
                  'User research: observe and talk to real users in their real contexts',
                  'Personas: create detailed profiles representing different user types',
                  'Accessibility: design for users with visual, hearing, motor, and cognitive differences',
                  'Inclusive design: consider age, culture, language, and socioeconomic diversity',
                  'Test with real users from diverse backgrounds, not just people like yourself',
                ],
              },
              {
                type: 'explore',
                title: 'When Empathy Was Missing',
                content: 'Many technology failures stem from a lack of empathy for users. Automatic soap dispensers that did not recognize darker skin tones because they were only tested on lighter skin. Voice assistants that could not understand accented English. Health apps that assumed all users could see the screen. Each failure represents a perspective that was not considered during design.',
              },
              {
                type: 'challenge',
                title: 'Empathetic Redesign',
                content: 'Choose an app or technology you use daily. Identify three groups of people who might struggle to use it (consider people with visual impairment, elderly users, non-native English speakers, people with limited data, etc.). Propose specific design changes that would make the product more accessible for each group. Sketch or describe your improved design.',
              },
              {
                type: 'connect',
                title: 'Your Design Impact',
                content: 'Every technology product you build or influence in the future will affect real people. The empathetic design skills you develop now — understanding diverse perspectives, testing with real users, and considering accessibility — will determine whether your creations help everyone or leave people behind. Design is not just aesthetics; it is an expression of values.',
              },
            ],
            quiz: [
              {
                id: 'q-eid-1',
                question: 'Why did automatic soap dispensers fail to work for some users?',
                options: [
                  'They were too expensive for certain locations',
                  'They used sensors tested primarily on lighter skin tones and failed with darker skin',
                  'They were installed at the wrong height',
                  'They required a special type of soap',
                ],
                correctIndex: 1,
                explanation: 'The infrared sensors in many automatic dispensers were tested primarily on lighter skin tones. The sensors worked by detecting reflected infrared light, and darker skin reflected less light, causing the sensors to fail. This is a clear example of what happens when product testing lacks diversity.',
              },
              {
                id: 'q-eid-2',
                question: 'What is the difference between accessibility and inclusive design?',
                options: [
                  'They are the same thing',
                  'Accessibility focuses on users with disabilities; inclusive design considers the full range of human diversity',
                  'Accessibility is more important than inclusive design',
                  'Inclusive design is only about language translation',
                ],
                correctIndex: 1,
                explanation: 'Accessibility specifically addresses the needs of people with disabilities (visual, hearing, motor, cognitive). Inclusive design is broader — it considers the full spectrum of human diversity including age, culture, language, socioeconomic status, and situational limitations. Accessibility is a subset of inclusive design.',
              },
              {
                id: 'q-eid-3',
                question: 'What is the most important step in empathetic design?',
                options: [
                  'Using the most advanced technology',
                  'Making the product look beautiful',
                  'Deeply understanding the real people who will use the product through research and testing with diverse users',
                  'Following the latest design trends',
                ],
                correctIndex: 2,
                explanation: 'Empathetic design begins and ends with understanding real users. No amount of advanced technology or aesthetic polish can compensate for not understanding who your users are, what they need, and what challenges they face. User research and testing with diverse groups is the foundation of empathetic design.',
              },
            ],
          },
        ],
      },
      // MODULE 5: Build Your Case
      {
        id: 'argumentation',
        title: 'Build Your Case',
        subtitle: 'Evidence-based argumentation',
        description: 'Master the art of building strong, evidence-based arguments and learn to engage constructively with opposing viewpoints.',
        icon: 'gavel',
        color: '#f59e0b',
        difficulty: 'intermediate',
        ageRange: '13-16',
        badgeId: 'badge-argumentation',
        badgeName: 'Master Debater',
        lessons: [
          {
            id: 'toulmin-model',
            title: 'The Toulmin Model',
            subtitle: 'Anatomy of a strong argument',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'The Six Parts of an Argument',
                content: 'The Toulmin Model breaks every argument into six components: Claim (your position), Data (evidence supporting it), Warrant (the reasoning that connects data to claim), Backing (support for the warrant), Qualifier (acknowledging limits), and Rebuttal (addressing counterarguments). Most weak arguments are missing one or more of these components.',
                bulletPoints: [
                  'Claim: the position or conclusion you are arguing for',
                  'Data: the evidence, facts, or examples that support your claim',
                  'Warrant: the logical reasoning connecting your data to your claim',
                  'Backing: additional support for why your warrant is valid',
                  'Qualifier: words that acknowledge limitations (usually, most, likely)',
                  'Rebuttal: addressing potential counterarguments proactively',
                ],
              },
              {
                type: 'explore',
                title: 'Toulmin in Action',
                content: 'Claim: "Schools should teach AI literacy." Data: "93% of jobs will be affected by AI by 2030, and students who understand AI make better career decisions." Warrant: "Education should prepare students for the world they will enter." Backing: "Research shows that early exposure to technology improves career outcomes." Qualifier: "While implementation will vary by school." Rebuttal: "Some argue school time is limited, but AI literacy can be integrated into existing subjects."',
              },
              {
                type: 'challenge',
                title: 'Build a Toulmin Argument',
                content: 'Choose a topic you care about and construct a complete Toulmin argument with all six components. Then have a friend try to find weaknesses. Strengthen any components they challenged. The goal is not to be "right" but to build the strongest, most honest argument possible.',
              },
              {
                type: 'reflect',
                title: 'Honest Argumentation',
                content: 'The purpose of argumentation is not to "win" but to arrive at the best possible understanding of an issue. Including qualifiers and rebuttals makes your argument more credible, not weaker. Acknowledging what you do not know is a sign of intellectual honesty that builds trust with your audience.',
              },
            ],
            quiz: [
              {
                id: 'q-tm-1',
                question: 'In the Toulmin Model, what is a "warrant"?',
                options: [
                  'A legal document',
                  'The logical reasoning that connects evidence to the claim',
                  'The weakest part of an argument',
                  'A guarantee that the argument is correct',
                ],
                correctIndex: 1,
                explanation: 'The warrant is the bridge between your data (evidence) and your claim (conclusion). It explains WHY your evidence supports your claim. Without a warrant, you have data and a claim but no logical connection between them.',
              },
              {
                id: 'q-tm-2',
                question: 'Why do qualifiers make an argument STRONGER, not weaker?',
                options: [
                  'They do not — qualifiers always weaken arguments',
                  'Because acknowledging limitations shows intellectual honesty and makes the argument more credible',
                  'Because qualifiers add more words to the argument',
                  'Because the Toulmin Model requires qualifiers by law',
                ],
                correctIndex: 1,
                explanation: 'Qualifiers (like "usually," "in most cases," "the evidence suggests") show that you understand the complexity of the issue and are not overstating your case. This intellectual honesty makes your argument more credible because audiences trust communicators who acknowledge uncertainty.',
              },
              {
                id: 'q-tm-3',
                question: 'What is the purpose of including a "rebuttal" in your argument?',
                options: [
                  'To insult people who disagree',
                  'To proactively address counterarguments, showing you have considered other perspectives',
                  'To make your argument longer',
                  'To admit that your argument is wrong',
                ],
                correctIndex: 1,
                explanation: 'Including a rebuttal shows you have thoughtfully considered opposing viewpoints and can explain why your position still holds. This strengthens your argument because it demonstrates broad analysis rather than one-sided advocacy.',
              },
            ],
          },
          {
            id: 'finding-strong-evidence',
            title: 'Finding Strong Evidence',
            subtitle: 'Not all evidence is created equal',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'The Evidence Hierarchy',
                content: 'Evidence varies widely in quality and reliability. At the top are systematic reviews and meta-analyses (combining many studies). Then randomized controlled trials. Then observational studies. Then expert opinions. At the bottom are anecdotes and personal experience. Understanding this hierarchy helps you evaluate whether evidence actually supports a claim.',
                bulletPoints: [
                  'Systematic reviews: combine results from many studies (strongest)',
                  'Randomized controlled trials: well-designed experiments with control groups',
                  'Observational studies: analyze data without experiments',
                  'Expert opinions: credible but subject to individual bias',
                  'Anecdotes: personal stories (weakest — can be misleading)',
                ],
              },
              {
                type: 'explore',
                title: 'Evaluating Sources',
                content: 'When evaluating evidence, ask: Who funded this research? Was it published in a peer-reviewed journal? What was the sample size? Can the results be replicated? Is the source known for accuracy? A pharmaceutical company\'s study of its own drug deserves more scrutiny than an independent study. A study of 50 people is less reliable than one with 5,000.',
              },
              {
                type: 'challenge',
                title: 'Evidence Scavenger Hunt',
                content: 'Find the strongest evidence you can for AND against this claim: "Violent video games cause real-world aggression." For each piece of evidence, evaluate its quality using the hierarchy. What level of evidence exists on each side? What does the overall body of evidence suggest? Write a balanced summary of what the evidence actually shows.',
              },
              {
                type: 'reflect',
                title: 'Living with Uncertainty',
                content: 'Strong evidence does not mean absolute proof. Even the best evidence has limitations. The goal is not certainty but informed confidence — making the best decision based on the best available evidence while remaining open to updating your beliefs when better evidence emerges. This is how science works, and it is how critical thinkers should work too.',
              },
            ],
            quiz: [
              {
                id: 'q-fse-1',
                question: 'Which type of evidence is considered STRONGEST in the evidence hierarchy?',
                options: [
                  'A compelling personal story',
                  'An expert\'s opinion',
                  'A systematic review combining results from many studies',
                  'A single observational study',
                ],
                correctIndex: 2,
                explanation: 'Systematic reviews and meta-analyses sit at the top of the evidence hierarchy because they combine and analyze results from many individual studies, providing a more comprehensive and reliable picture than any single study alone.',
              },
              {
                id: 'q-fse-2',
                question: 'Why should you ask "Who funded this research?"',
                options: [
                  'Because research is always expensive',
                  'Because funding sources can create conflicts of interest that bias the research design and reporting',
                  'Because only expensive research is good research',
                  'Because this information is on the final exam',
                ],
                correctIndex: 1,
                explanation: 'Funding sources can create conflicts of interest. Research funded by organizations with a financial stake in the outcome may be (consciously or unconsciously) designed or reported in ways that favor the funder. Independent research and disclosed conflicts of interest are more trustworthy.',
              },
              {
                id: 'q-fse-3',
                question: 'Why are personal anecdotes considered weak evidence?',
                options: [
                  'Because personal experiences are never true',
                  'Because a single experience is not representative and can be misleading; it does not account for broader patterns',
                  'Because only scientists can provide evidence',
                  'Because anecdotes are always made up',
                ],
                correctIndex: 1,
                explanation: 'Personal anecdotes are limited because one person\'s experience may not be representative of broader patterns. Someone who smoked and lived to 100 does not disprove smoking\'s health risks. Individual stories can be true but misleading when used to draw general conclusions.',
              },
            ],
          },
          {
            id: 'steelman-challenge',
            title: 'The Steelman Challenge',
            subtitle: 'Making opposing arguments stronger',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Steelmanning vs Strawmanning',
                content: 'A strawman is a weak, distorted version of someone\'s argument that is easy to defeat. A steelman is the strongest, most charitable version of someone\'s argument. Steelmanning is the practice of engaging with the best version of an opposing viewpoint. It is harder than strawmanning, but it leads to deeper understanding and more productive disagreements.',
                bulletPoints: [
                  'Strawman: weakening an argument to easily knock it down (dishonest)',
                  'Steelman: strengthening an argument to engage with its best form (honest)',
                  'Steelmanning shows intellectual honesty and builds respect',
                  'If you can defeat the strongest version of an argument, your position is truly strong',
                  'Steelmanning often reveals that opposing views have more merit than you initially thought',
                ],
              },
              {
                type: 'explore',
                title: 'Why Steelmanning Matters',
                content: 'In debates about AI regulation, technology in schools, or social media age limits, people often argue against caricatures of the other side. "You just want to ban all technology!" vs "You just want children exposed to everything!" Neither represents the actual opposing view. Steelmanning requires you to genuinely understand why smart, thoughtful people hold a different position.',
              },
              {
                type: 'challenge',
                title: 'The Steelman Exercise',
                content: 'Pick a position you strongly disagree with. Write the strongest possible argument FOR that position — better than its actual proponents could make. Include strong evidence, acknowledge the weaknesses of YOUR position, and present the opposing view with genuine respect. If someone who holds that position would say "yes, that represents my view well," you have succeeded.',
              },
              {
                type: 'reflect',
                title: 'Growth Through Disagreement',
                content: 'The purpose of steelmanning is not to change your mind but to deepen your thinking. When you engage seriously with opposing views, you either discover valid points that improve your own position or you strengthen your arguments by addressing the best counterpoints. Either way, you grow. The only people who do not grow are those who never seriously engage with ideas they disagree with.',
              },
            ],
            quiz: [
              {
                id: 'q-sc-1',
                question: 'What is a "steelman" argument?',
                options: [
                  'An argument made by a strong person',
                  'The strongest, most charitable version of an opposing viewpoint',
                  'An argument made entirely of facts',
                  'An unbeatable argument',
                ],
                correctIndex: 1,
                explanation: 'A steelman is the best, most charitable interpretation of an opposing argument — presented in its strongest possible form. It is the opposite of a strawman, which misrepresents an argument to make it easier to attack.',
              },
              {
                id: 'q-sc-2',
                question: 'Why is steelmanning more productive than strawmanning?',
                options: [
                  'Because it takes less effort',
                  'Because engaging with the strongest version of an argument leads to deeper understanding and more meaningful discussion',
                  'Because strawmanning is illegal',
                  'Because steelmanning always changes people\'s minds',
                ],
                correctIndex: 1,
                explanation: 'Steelmanning forces you to genuinely understand opposing views, which leads to deeper thinking. If you can address the strongest form of an argument, your position is truly robust. Strawmanning only creates the illusion of winning while leaving the real argument unaddressed.',
              },
              {
                id: 'q-sc-3',
                question: 'How do you know you have successfully steelmanned an opposing position?',
                options: [
                  'When you have completely changed your mind',
                  'When someone who holds that position would say your representation is fair and accurate',
                  'When the opposing person gives up',
                  'When you can no longer think of counterarguments',
                ],
                correctIndex: 1,
                explanation: 'A successful steelman is one that proponents of the position would recognize as a fair, accurate, and strong representation of their view. The test is whether they would say "Yes, that captures what I believe and why" — not a caricature but a genuine articulation.',
              },
            ],
          },
        ],
      },
      // MODULE 6: Systems Thinking
      {
        id: 'systems-thinking',
        title: 'Systems Thinking',
        subtitle: 'Everything is connected',
        description: 'Learn to see the interconnections, feedback loops, and unintended consequences that shape complex systems from ecosystems to social media.',
        icon: 'network',
        color: '#f59e0b',
        difficulty: 'intermediate',
        ageRange: '14-18',
        badgeId: 'badge-systems-thinking',
        badgeName: 'Systems Thinker',
        lessons: [
          {
            id: 'feedback-loops',
            title: 'Feedback Loops',
            subtitle: 'When effects become causes',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Positive and Negative Feedback',
                content: 'A feedback loop occurs when the output of a system becomes an input that affects future output. Positive (reinforcing) feedback amplifies change — like a microphone pointed at a speaker creating louder and louder sound. Negative (balancing) feedback counteracts change — like a thermostat turning off heat when the room gets warm enough. Both types shape every complex system.',
                bulletPoints: [
                  'Reinforcing loops: amplify change (growth or decline accelerates)',
                  'Balancing loops: counteract change (system returns to equilibrium)',
                  'Viral content: more shares lead to more visibility lead to more shares (reinforcing)',
                  'Body temperature: sweating cools you down when you overheat (balancing)',
                  'Most real systems have BOTH types of loops interacting',
                ],
              },
              {
                type: 'explore',
                title: 'Feedback Loops in Technology',
                content: 'Social media engagement creates a powerful reinforcing loop: controversial content generates reactions, reactions boost algorithmic visibility, visibility generates more reactions. This is why outrage spreads faster than nuance. Understanding this loop explains platform behavior better than blaming individual users or companies — the system\'s structure drives the behavior.',
              },
              {
                type: 'challenge',
                title: 'Map a Feedback Loop',
                content: 'Choose a system you interact with (a school, a sports team, a social media platform). Draw a diagram showing at least two feedback loops — one reinforcing and one balancing. Label each element and show how it connects to the next. Identify which loops are currently dominant and what would happen if the balance shifted.',
              },
              {
                type: 'reflect',
                title: 'Seeing the System',
                content: 'Most people blame individuals when systems produce bad outcomes. "The CEO is greedy" or "users are lazy." Systems thinking reveals that structures and incentives often matter more than individual choices. If you want to change outcomes, change the system structure — especially its feedback loops.',
              },
            ],
            quiz: [
              {
                id: 'q-fl-1',
                question: 'What is a reinforcing (positive) feedback loop?',
                options: [
                  'A loop that always produces good outcomes',
                  'A loop where the output amplifies the input, causing change to accelerate',
                  'A loop that provides positive encouragement',
                  'A loop that balances the system',
                ],
                correctIndex: 1,
                explanation: 'A reinforcing feedback loop amplifies change in whatever direction the system is moving. More leads to more (or less leads to less). "Positive" here does not mean "good" — it means "amplifying." A death spiral is a reinforcing loop with negative outcomes.',
              },
              {
                id: 'q-fl-2',
                question: 'How do feedback loops explain why outrage spreads faster than nuance on social media?',
                options: [
                  'Because nuance is boring',
                  'Because outrage content generates more reactions, which boosts algorithmic visibility, which generates more reactions — a reinforcing loop',
                  'Because social media companies manually promote outrage',
                  'Because only angry people use social media',
                ],
                correctIndex: 1,
                explanation: 'Outrage triggers stronger emotional reactions (comments, shares, quote tweets), which algorithms interpret as "high engagement." High engagement leads to more visibility, which generates more reactions. This reinforcing loop structurally amplifies emotionally provocative content.',
              },
              {
                id: 'q-fl-3',
                question: 'What is the most effective way to change a system\'s behavior?',
                options: [
                  'Blame the people in the system',
                  'Ignore the system and focus on individuals',
                  'Modify the system\'s structure, especially its feedback loops',
                  'Replace all the people in the system',
                ],
                correctIndex: 2,
                explanation: 'Systems thinking reveals that system structure (rules, incentives, feedback loops) drives behavior more than individual choices. If a system consistently produces unwanted outcomes, changing its structure is more effective than blaming individuals who are responding rationally to the system\'s incentives.',
              },
            ],
          },
          {
            id: 'unintended-consequences',
            title: 'Unintended Consequences',
            subtitle: 'The law of surprises',
            xpReward: 75,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'Why Good Intentions Go Wrong',
                content: 'Complex systems often produce outcomes that nobody intended or expected. Introducing cane toads to Australia to control beetles led to an ecological disaster. Social media was designed to connect people but contributed to political polarization. Well-intentioned AI systems have produced discriminatory outcomes. Understanding unintended consequences is essential for responsible technology development.',
                bulletPoints: [
                  'Cobra effect: a solution makes the original problem worse',
                  'Perverse incentive: a reward system encourages the opposite of what was intended',
                  'Cascading effects: a change in one part of the system triggers changes throughout',
                  'Time delays: consequences that do not appear until long after the action',
                  'The more complex the system, the harder it is to predict consequences',
                ],
              },
              {
                type: 'explore',
                title: 'Tech Unintended Consequences',
                content: 'GPS navigation apps were designed to find the fastest route. But when everyone uses the same app, it routes traffic through quiet residential streets, creating congestion and safety issues in neighborhoods that never had through-traffic. The technology solved the individual problem (faster route) while creating a collective problem (overwhelmed residential streets).',
              },
              {
                type: 'challenge',
                title: 'Consequence Mapping',
                content: 'Choose a proposed technology solution (e.g., AI grading student essays, self-driving delivery robots, social media age verification). Map out at least 5 potential unintended consequences — both positive and negative. For each, explain the causal chain: what action leads to what reaction leads to what unintended outcome? Propose ways to mitigate the negative consequences.',
              },
              {
                type: 'reflect',
                title: 'Humility in Design',
                content: 'Unintended consequences are not a sign of failure — they are inevitable when complex systems interact. The lesson is humility: deploy cautiously, monitor carefully, be willing to adjust, and listen to affected communities. The best technologists are not those who predict everything but those who respond quickly when the unexpected happens.',
              },
            ],
            quiz: [
              {
                id: 'q-uc-1',
                question: 'What is the "cobra effect"?',
                options: [
                  'A venomous snake that affects technology',
                  'When a solution to a problem inadvertently makes the problem worse',
                  'A type of positive feedback loop',
                  'A coding error that multiplies',
                ],
                correctIndex: 1,
                explanation: 'The cobra effect is named after a historical incident where a bounty on cobras in India led people to breed cobras for the reward. When the program was scrapped, breeders released the snakes, making the cobra problem worse. It describes any policy or solution that backfires and worsens the original problem.',
              },
              {
                id: 'q-uc-2',
                question: 'Why are unintended consequences more common in complex systems?',
                options: [
                  'Because complex systems have more components and interactions, making outcomes harder to predict',
                  'Because complex systems are poorly designed',
                  'Because nobody tries to anticipate consequences in complex systems',
                  'Because complex systems are newer than simple systems',
                ],
                correctIndex: 0,
                explanation: 'Complex systems have many interconnected components with non-linear relationships and feedback loops. A change in one part can cascade through the system in unexpected ways. The more components and connections, the more difficult it is to predict all the effects of any single change.',
              },
              {
                id: 'q-uc-3',
                question: 'What is the best approach to managing unintended consequences?',
                options: [
                  'Do nothing and hope for the best',
                  'Never build anything new because something might go wrong',
                  'Deploy cautiously, monitor carefully, and be ready to adjust when unexpected outcomes appear',
                  'Ignore consequences and focus only on the intended benefits',
                ],
                correctIndex: 2,
                explanation: 'Since unintended consequences are inevitable in complex systems, the best approach is to deploy changes incrementally, monitor for unexpected outcomes, maintain feedback channels with affected communities, and be willing to adjust quickly. This approach balances innovation with responsibility.',
              },
            ],
          },
          {
            id: 'leverage-points',
            title: 'Leverage Points',
            subtitle: 'Where small changes have big effects',
            xpReward: 75,
            durationMinutes: 18,
            sections: [
              {
                type: 'learn',
                title: 'What Are Leverage Points?',
                content: 'A leverage point is a place in a system where a small change can produce a big effect. Donella Meadows identified a hierarchy of leverage points, from least to most powerful: parameters (numbers like tax rates), feedback loops, information flows, system rules, system goals, and the power to change the system itself. Understanding leverage points helps you make the most impactful changes.',
                bulletPoints: [
                  'Parameters: adjusting numbers within the system (weakest lever)',
                  'Feedback loops: changing how information flows back to decision-makers',
                  'Rules: changing what is allowed, prohibited, or incentivized',
                  'Goals: changing what the system is trying to achieve',
                  'Paradigm: changing the mindset out of which the system arises (strongest lever)',
                ],
              },
              {
                type: 'explore',
                title: 'Leverage Points in AI',
                content: 'Consider social media algorithms. A weak lever: adjusting the algorithm\'s parameters (change how much it values comments vs likes). A stronger lever: changing the feedback loops (require algorithms to optimize for user well-being, not just engagement). The strongest lever: changing the paradigm (shifting from "attention economy" to "connection economy"). Each higher-level change has more transformative potential.',
              },
              {
                type: 'challenge',
                title: 'Find the Lever',
                content: 'Choose a problem you care about (climate change, educational inequality, online harassment). Identify leverage points at three different levels: a parameter change, a rule change, and a goal/paradigm change. Evaluate which would be most effective and most feasible. Often the most powerful levers are the hardest to pull.',
              },
              {
                type: 'reflect',
                title: 'Your Power to Change Systems',
                content: 'You might feel powerless to change large systems, but understanding leverage points reveals that strategic action can be far more effective than brute force. Throughout history, small groups of people who found the right leverage points have changed entire systems. The knowledge you are building right now is part of finding those levers.',
              },
            ],
            quiz: [
              {
                id: 'q-lp-1',
                question: 'According to Donella Meadows, which is a MORE powerful leverage point?',
                options: [
                  'Adjusting a number in the system (like a tax rate)',
                  'Changing the goal of the system',
                  'Both are equally powerful',
                  'Neither can change a system',
                ],
                correctIndex: 1,
                explanation: 'Changing system goals is a much more powerful lever than adjusting parameters. Adjusting a tax rate tweaks behavior within the existing system. Changing the system\'s goal (e.g., from "maximize profit" to "maximize well-being") transforms the entire system and all the decisions within it.',
              },
              {
                id: 'q-lp-2',
                question: 'In the context of social media, which change would be the MOST powerful leverage point?',
                options: [
                  'Tweaking the algorithm to show 5% more news content',
                  'Requiring algorithms to optimize for user well-being instead of engagement',
                  'Adding a new emoji reaction',
                  'Changing the platform\'s color scheme',
                ],
                correctIndex: 1,
                explanation: 'Changing what algorithms optimize for changes the system\'s fundamental goal. Currently optimizing for engagement drives harmful content amplification. Switching to well-being optimization would restructure the entire system\'s behavior — a far more powerful change than adjusting any single parameter.',
              },
              {
                id: 'q-lp-3',
                question: 'Why are the most powerful leverage points often the hardest to use?',
                options: [
                  'Because they require the most money',
                  'Because they challenge existing structures, beliefs, and power dynamics that resist change',
                  'Because they require the most advanced technology',
                  'Because powerful leverage points do not actually exist',
                ],
                correctIndex: 1,
                explanation: 'Higher-level leverage points (changing rules, goals, paradigms) challenge established power structures and deeply held beliefs. Those who benefit from the current system resist changes to its fundamental goals and assumptions. This is why paradigm shifts are both the most powerful and most contested changes.',
              },
            ],
          },
        ],
      },
      // MODULE 7: Ethics for the AI Age
      {
        id: 'ethics-philosophy',
        title: 'Ethics for the AI Age',
        subtitle: 'Doing the right thing',
        description: 'Explore ethical frameworks, apply them to real AI dilemmas, and learn to conduct stakeholder analysis for technology decisions.',
        icon: 'compass',
        color: '#f59e0b',
        difficulty: 'advanced',
        ageRange: '15-18',
        badgeId: 'badge-ethics-philosophy',
        badgeName: 'Ethics Navigator',
        lessons: [
          {
            id: 'ethical-frameworks',
            title: 'Ethical Frameworks',
            subtitle: 'Different lenses for right and wrong',
            xpReward: 100,
            durationMinutes: 22,
            sections: [
              {
                type: 'learn',
                title: 'Major Ethical Frameworks',
                content: 'Ethics provides systematic approaches to deciding what is right. Utilitarianism focuses on maximizing overall happiness for the greatest number. Deontology focuses on following moral rules regardless of outcomes. Virtue ethics asks what a good person would do. Care ethics prioritizes relationships and responsibilities to others. Each framework can lead to different conclusions about the same situation.',
                bulletPoints: [
                  'Utilitarianism: maximize total well-being for the greatest number',
                  'Deontology: follow moral rules and duties (e.g., never lie, respect autonomy)',
                  'Virtue ethics: act as a person of good character would act',
                  'Care ethics: prioritize relationships and responsibility to those who depend on you',
                  'Rights-based: protect individual rights even if outcomes are not optimal',
                ],
              },
              {
                type: 'explore',
                title: 'Frameworks in Conflict',
                content: 'Consider whether AI companies should use copyrighted art to train image generators. Utilitarianism might say yes — millions benefit from AI art tools. Deontology might say no — using work without permission violates artists\' rights. Virtue ethics might ask whether a fair-minded person would want their work used without consent. Each framework highlights different moral considerations.',
              },
              {
                type: 'challenge',
                title: 'Apply All Frameworks',
                content: 'A self-driving car AI must decide: swerve to avoid a pedestrian (risking the passenger) or stay on course (risking the pedestrian). Analyze this dilemma using each ethical framework: What would a utilitarian decide? A deontologist? Someone using virtue ethics? Care ethics? Note where the frameworks agree and disagree. What does this tell you about ethics?',
              },
              {
                type: 'reflect',
                title: 'Why Multiple Frameworks Matter',
                content: 'No single ethical framework captures the full complexity of moral decision-making. The best ethical thinkers use multiple frameworks as lenses — each reveals different aspects of a dilemma. When multiple frameworks agree, you can be more confident. When they disagree, you know the issue is genuinely complex and deserves careful thought.',
              },
            ],
            quiz: [
              {
                id: 'q-ef-1',
                question: 'What does utilitarianism primarily focus on?',
                options: [
                  'Following rules regardless of consequences',
                  'Maximizing overall well-being for the greatest number of people',
                  'What a virtuous person would do',
                  'Protecting individual rights above all else',
                ],
                correctIndex: 1,
                explanation: 'Utilitarianism, developed by Jeremy Bentham and John Stuart Mill, judges actions by their consequences — specifically, whether they maximize overall happiness or well-being for the greatest number of people. An action is right if it produces more total good than any alternative.',
              },
              {
                id: 'q-ef-2',
                question: 'How would a deontologist approach an ethical AI dilemma?',
                options: [
                  'Calculate which option produces the most happiness',
                  'Follow moral rules and duties regardless of the consequences',
                  'Do whatever the majority of people want',
                  'Choose the option that costs the least money',
                ],
                correctIndex: 1,
                explanation: 'Deontology (from Kant and others) holds that certain actions are morally right or wrong regardless of their outcomes. A deontologist would focus on moral duties — like respecting autonomy, keeping promises, and not using people as means to an end — even if violating those rules would produce better outcomes.',
              },
              {
                id: 'q-ef-3',
                question: 'Why is it valuable to analyze an ethical dilemma through MULTIPLE frameworks?',
                options: [
                  'Because using more frameworks makes you sound smarter',
                  'Because each framework reveals different aspects of the dilemma, and agreement across frameworks increases confidence',
                  'Because one framework is always right and the others are always wrong',
                  'Because ethics requires using exactly four frameworks',
                ],
                correctIndex: 1,
                explanation: 'Different ethical frameworks highlight different moral considerations. Using multiple lenses gives you a more complete picture of a dilemma. When multiple frameworks agree on an answer, you can be more confident. When they disagree, you know the issue is genuinely complex and requires careful deliberation.',
              },
            ],
          },
          {
            id: 'trolley-problem-ai',
            title: 'The Trolley Problem & AI',
            subtitle: 'Classic dilemmas meet modern technology',
            xpReward: 100,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'The Classic Trolley Problem',
                content: 'A runaway trolley is heading toward five people. You can pull a lever to divert it to another track where it will hit one person. Should you pull the lever? Most people say yes — saving five at the cost of one seems logical. But a variation asks: would you push a large person off a bridge to stop the trolley? Most people say no, even though the math is the same. This reveals that our moral intuitions are more complex than simple math.',
                bulletPoints: [
                  'The basic trolley problem tests utilitarian vs deontological thinking',
                  'Variations reveal the role of intention, directness, and emotional response',
                  'There is no universally "correct" answer — that is the point',
                  'The trolley problem has become directly relevant to autonomous vehicle design',
                ],
              },
              {
                type: 'explore',
                title: 'AI Trolley Problems Are Real',
                content: 'Self-driving cars face trolley-problem-like decisions every time they navigate complex traffic. Who should the car protect if a crash is unavoidable — the passenger or the pedestrian? Should the car value young lives over old? Should these decisions be made by engineers, governments, or the car owners? The MIT Moral Machine project collected 40 million responses from people worldwide, revealing deep cultural differences in moral priorities.',
              },
              {
                type: 'challenge',
                title: 'Design an Ethical AI Policy',
                content: 'You are on a committee designing ethical guidelines for self-driving cars. Draft a policy that addresses: (1) Whose safety should be prioritized in unavoidable crash scenarios? (2) Should passengers be able to customize the car\'s ethical settings? (3) Who is legally responsible — the manufacturer, the passenger, or the AI? Justify each decision using ethical frameworks.',
              },
              {
                type: 'reflect',
                title: 'The Limits of Optimization',
                content: 'The trolley problem exposes a fundamental challenge: some ethical decisions cannot be reduced to optimization. You cannot simply "maximize lives saved" because that ignores the moral significance of how those lives are at risk. Similarly, AI cannot resolve all ethical dilemmas through mathematical optimization — some decisions require human moral judgment, cultural context, and democratic input.',
              },
            ],
            quiz: [
              {
                id: 'q-tp-1',
                question: 'What does the trolley problem primarily reveal about human morality?',
                options: [
                  'That most people are immoral',
                  'That our moral intuitions are more complex than simple calculations of lives saved',
                  'That philosophy is useless for real-world problems',
                  'That there is always one correct answer to moral dilemmas',
                ],
                correctIndex: 1,
                explanation: 'The trolley problem reveals that human moral reasoning involves more than just calculating the best outcome. Factors like directness of action, intention, and emotional responses all play roles. This complexity is exactly what makes programming ethical AI so challenging.',
              },
              {
                id: 'q-tp-2',
                question: 'What did the MIT Moral Machine project discover?',
                options: [
                  'That all humans share the same moral values',
                  'That moral priorities differ significantly across cultures',
                  'That machines are more ethical than humans',
                  'That nobody cares about self-driving car ethics',
                ],
                correctIndex: 1,
                explanation: 'The Moral Machine project collected 40 million responses from people in 233 countries and found significant cultural variation in moral priorities. Some cultures prioritized saving young over old, others prioritized following rules, and some prioritized social status differently. This has direct implications for deploying self-driving cars globally.',
              },
              {
                id: 'q-tp-3',
                question: 'Why can\'t AI resolve all ethical dilemmas through mathematical optimization?',
                options: [
                  'Because AI is not powerful enough yet',
                  'Because some ethical decisions involve values, context, and moral considerations that cannot be reduced to numbers',
                  'Because math does not apply to ethics',
                  'Because ethical dilemmas are always easy to solve',
                ],
                correctIndex: 1,
                explanation: 'Ethical dilemmas often involve competing values, cultural contexts, and moral principles that resist quantification. Reducing ethics to optimization (maximizing one metric) ignores the complexity of moral reasoning — the significance of intention, the rights of individuals, and the role of relationships and community values.',
              },
            ],
          },
          {
            id: 'stakeholder-analysis',
            title: 'Stakeholder Analysis',
            subtitle: 'Who is affected and who has power?',
            xpReward: 100,
            durationMinutes: 20,
            sections: [
              {
                type: 'learn',
                title: 'Identifying Stakeholders',
                content: 'A stakeholder is anyone who is affected by or can affect a decision. In AI development, stakeholders include users, developers, investors, regulators, communities impacted by the system, and future generations. Stakeholder analysis maps who is affected, how they are affected, how much power they have, and whose voices are currently missing from the conversation.',
                bulletPoints: [
                  'Primary stakeholders: directly affected by the AI system',
                  'Secondary stakeholders: indirectly affected',
                  'Power mapping: who has influence over decisions vs who bears the consequences',
                  'Voice gap: often those most affected have the least power',
                  'Consider future stakeholders — people not yet born who will live with today\'s decisions',
                ],
              },
              {
                type: 'explore',
                title: 'The Power Asymmetry',
                content: 'A common pattern in AI development: the people making decisions (engineers, executives, investors) are different from the people most affected by those decisions (users, communities, vulnerable populations). A facial recognition system might be built by engineers in Silicon Valley but deployed on communities in cities thousands of miles away. Stakeholder analysis reveals and addresses this power gap.',
              },
              {
                type: 'challenge',
                title: 'Conduct a Stakeholder Analysis',
                content: 'Choose an AI system (predictive policing, college admissions AI, social media content moderation, or AI medical diagnosis). Identify all stakeholders, map their interests and power levels, identify whose voices are currently missing, and propose ways to include underrepresented stakeholders in the decision-making process. Present your analysis.',
              },
              {
                type: 'connect',
                title: 'From Analysis to Advocacy',
                content: 'Stakeholder analysis is not just an academic exercise — it is a tool for advocacy. When you can clearly articulate who is affected by a technology decision and whose voices are missing, you can advocate for more inclusive and just processes. The skills you are learning here prepare you to be an effective voice for responsible technology development.',
              },
            ],
            quiz: [
              {
                id: 'q-sa-1',
                question: 'What is a "stakeholder" in the context of AI development?',
                options: [
                  'Only the people who invest money in the AI company',
                  'Anyone who is affected by or can affect the AI system and its outcomes',
                  'Only the engineers who build the AI',
                  'Only the users who directly interact with the AI',
                ],
                correctIndex: 1,
                explanation: 'Stakeholders include everyone who is affected by or can affect the system — users, developers, investors, communities, regulators, and even future generations. Limiting stakeholder consideration to just investors or engineers misses the broader impact of AI systems.',
              },
              {
                id: 'q-sa-2',
                question: 'What is the "voice gap" in AI development?',
                options: [
                  'When AI cannot process voice commands',
                  'When those most affected by AI decisions have the least power to influence those decisions',
                  'When engineers do not document their code',
                  'When AI systems cannot generate speech',
                ],
                correctIndex: 1,
                explanation: 'The voice gap refers to the common situation where the communities most impacted by AI systems (low-income neighborhoods subject to predictive policing, workers displaced by automation) have the least influence over how those systems are designed and deployed.',
              },
              {
                id: 'q-sa-3',
                question: 'Why should stakeholder analysis consider future generations?',
                options: [
                  'Because they will buy future products',
                  'Because AI decisions made today create systems and precedents that will affect people who are not yet born',
                  'Because future people are more important than current people',
                  'Because it is required by law in all countries',
                ],
                correctIndex: 1,
                explanation: 'AI systems and the norms around them create lasting structures. Data collected today may be used for decades. Algorithmic systems become entrenched. Precedents set now shape future possibilities. Including future generations in stakeholder analysis helps ensure that short-term decisions do not create long-term harms.',
              },
            ],
          },
        ],
      },
      // MODULE 8: Creative Problem-Solving
      {
        id: 'creative-problem-solving',
        title: 'Creative Problem-Solving',
        subtitle: 'Think different',
        description: 'Master creative thinking methods from design thinking to brainstorming, and learn how constraints can fuel innovation.',
        icon: 'lightbulb',
        color: '#f59e0b',
        difficulty: 'beginner',
        ageRange: 'all',
        badgeId: 'badge-creative-problem-solving',
        badgeName: 'Innovation Champion',
        lessons: [
          {
            id: 'design-thinking',
            title: 'Design Thinking',
            subtitle: 'A human-centered approach to innovation',
            xpReward: 50,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'The Five Stages',
                content: 'Design thinking is a problem-solving approach that puts human needs at the center. It follows five stages: Empathize (understand the people you are designing for), Define (clearly articulate the problem), Ideate (generate many possible solutions), Prototype (build quick, rough versions), and Test (try solutions with real users and learn). The process is not linear — you often loop back to earlier stages.',
                bulletPoints: [
                  'Empathize: observe, interview, and understand users deeply',
                  'Define: frame the problem as a clear, actionable statement',
                  'Ideate: generate many diverse solutions without judging them',
                  'Prototype: build quick, inexpensive versions to make ideas tangible',
                  'Test: put prototypes in front of real users and learn from their reactions',
                ],
              },
              {
                type: 'explore',
                title: 'Design Thinking in Action',
                content: 'IDEO used design thinking to redesign the shopping cart. Instead of starting with cart design, they started by observing shoppers. They discovered that people struggled with maneuverability, child safety, and checkout efficiency. Their redesign addressed the human problems, not just the physical object. This human-centered approach produced solutions that pure engineering would have missed.',
              },
              {
                type: 'challenge',
                title: 'Apply Design Thinking',
                content: 'Choose a problem at your school (confusing schedules, boring lunches, inefficient hallway traffic). Apply the five design thinking stages. Empathize with affected people by interviewing at least three. Define the core problem in one sentence. Ideate at least ten solutions. Prototype your best idea using paper, cardboard, or digital mockups. Test it with potential users.',
              },
              {
                type: 'reflect',
                title: 'Why Human-Centered Matters',
                content: 'Many failed products were technically impressive but did not solve a real human problem. Google Glass was an engineering marvel that nobody wanted to wear. Design thinking prevents this by ensuring you deeply understand human needs before building solutions. In the AI age, the most successful innovators will combine technical AI skills with human-centered design thinking.',
              },
            ],
            quiz: [
              {
                id: 'q-dt-1',
                question: 'What is the FIRST stage of design thinking?',
                options: [
                  'Build a prototype',
                  'Empathize — understand the people you are designing for',
                  'Define the problem',
                  'Generate solutions',
                ],
                correctIndex: 1,
                explanation: 'Design thinking always begins with Empathize — deeply understanding the people who will use your solution. This ensures that everything that follows is grounded in real human needs rather than assumptions about what people want.',
              },
              {
                id: 'q-dt-2',
                question: 'Why is prototyping done with quick, rough versions rather than polished products?',
                options: [
                  'Because companies want to save money',
                  'Because rough prototypes allow you to test ideas quickly, fail cheaply, and iterate before investing in a final version',
                  'Because users prefer ugly products',
                  'Because polished products are impossible to build',
                ],
                correctIndex: 1,
                explanation: 'Quick, rough prototypes let you test assumptions and gather feedback early, when changes are cheap and easy. A paper mockup tested in an afternoon can save months of building the wrong solution. The goal is learning, not perfection.',
              },
              {
                id: 'q-dt-3',
                question: 'Why is the design thinking process described as "non-linear"?',
                options: [
                  'Because the stages can be done in any random order',
                  'Because insights from testing often send you back to earlier stages to redefine the problem or generate new ideas',
                  'Because non-linear processes are always better',
                  'Because design thinking was created by mathematicians',
                ],
                correctIndex: 1,
                explanation: 'Design thinking is non-linear because discoveries at later stages (like user testing) often reveal that you need to revisit earlier stages. Testing might show your problem definition was wrong, or prototyping might reveal new ideation opportunities. This iterative looping is a feature, not a flaw.',
              },
            ],
          },
          {
            id: 'brainstorming-methods',
            title: 'Brainstorming Methods',
            subtitle: 'Generating ideas beyond the obvious',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Beyond Basic Brainstorming',
                content: 'Traditional brainstorming (shout out ideas) often underperforms because of social dynamics — people self-censor, dominant voices take over, and early ideas anchor thinking. Better methods exist: brainwriting (everyone writes ideas silently first), SCAMPER (systematic modification of existing ideas), reverse brainstorming (how could we make it worse?), and random input (use random stimuli to spark new connections).',
                bulletPoints: [
                  'Brainwriting: write ideas silently before sharing (reduces groupthink)',
                  'SCAMPER: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse',
                  'Reverse brainstorming: ask "how could we make this problem worse?" then flip the answers',
                  'Random input: use a random word or image as a creative springboard',
                  'Quantity breeds quality: generate many ideas first, evaluate later',
                ],
              },
              {
                type: 'explore',
                title: 'Why Quantity Breeds Quality',
                content: 'Research shows that the best ideas usually come after the obvious ones are exhausted. The first ideas in a brainstorm tend to be conventional and expected. It is idea number 15 or 20 — when the obvious ideas are used up — that breakthrough thinking often emerges. This is why good brainstorming methods push for high volume before any evaluation.',
              },
              {
                type: 'challenge',
                title: 'Brainstorm Battle',
                content: 'Use three different brainstorming methods on the same problem: "How might we make learning more engaging for teenagers?" Method 1: traditional brainstorm for 5 minutes. Method 2: SCAMPER applied to current education. Method 3: reverse brainstorm (how to make learning as boring as possible, then flip each answer). Compare the quantity and quality of ideas from each method.',
              },
              {
                type: 'connect',
                title: 'AI as Brainstorm Partner',
                content: 'AI makes an excellent brainstorming partner. It can generate dozens of ideas quickly, combine concepts in unexpected ways, and help you explore directions you would not have considered. Use AI to expand your thinking during the ideation phase, then apply your human judgment to evaluate and select the best ideas.',
              },
            ],
            quiz: [
              {
                id: 'q-bm-1',
                question: 'Why does traditional brainstorming (shouting out ideas in a group) often underperform?',
                options: [
                  'Because it is too fast',
                  'Because social dynamics cause self-censoring, dominant voices take over, and early ideas anchor thinking',
                  'Because groups generate fewer ideas than individuals',
                  'Because brainstorming was not designed for modern problems',
                ],
                correctIndex: 1,
                explanation: 'Research shows that traditional verbal brainstorming suffers from production blocking (only one person speaks at a time), evaluation apprehension (people self-censor to avoid judgment), and anchoring (early ideas constrain later thinking). Methods like brainwriting address these issues.',
              },
              {
                id: 'q-bm-2',
                question: 'What does SCAMPER stand for?',
                options: [
                  'Search, Create, Analyze, Make, Plan, Execute, Review',
                  'Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse',
                  'Start, Continue, Add, Maintain, Pause, Extend, Restart',
                  'Simple, Complex, Abstract, Meaningful, Practical, Elegant, Radical',
                ],
                correctIndex: 1,
                explanation: 'SCAMPER is a systematic creativity tool that helps you generate new ideas by applying seven types of modifications to existing solutions: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, and Reverse.',
              },
              {
                id: 'q-bm-3',
                question: 'Why does "quantity breed quality" in brainstorming?',
                options: [
                  'Because more ideas mean more words',
                  'Because breakthrough ideas typically emerge after obvious ones are exhausted, usually around idea 15-20 or beyond',
                  'Because quality does not matter in brainstorming',
                  'Because every idea is equally good',
                ],
                correctIndex: 1,
                explanation: 'The first ideas in any brainstorm tend to be obvious and conventional. It is when you push past the easy answers — around idea 15-20 and beyond — that truly creative and unexpected ideas emerge. High volume forces your brain past the familiar and into novel territory.',
              },
            ],
          },
          {
            id: 'constraint-based-creativity',
            title: 'Constraint-Based Creativity',
            subtitle: 'Limitations as fuel for innovation',
            xpReward: 50,
            durationMinutes: 12,
            sections: [
              {
                type: 'learn',
                title: 'Constraints Spark Creativity',
                content: 'Counter-intuitively, constraints often boost creativity rather than limiting it. Twitter\'s 280-character limit forced users to write concisely. Haiku\'s strict 5-7-5 syllable structure pushes poets to choose every word carefully. Budget limitations force startups to find clever solutions instead of throwing money at problems. When everything is possible, it is hard to choose. When options are limited, creativity flourishes.',
                bulletPoints: [
                  'Too much freedom can cause decision paralysis',
                  'Constraints force creative problem-solving within defined boundaries',
                  'Resource constraints drive efficiency and innovation',
                  'Time constraints prevent over-thinking and encourage action',
                  'The best solutions often emerge from tight constraints',
                ],
              },
              {
                type: 'explore',
                title: 'Constraints in Technology',
                content: 'Some of the most successful products were born from constraints. Instagram started as a photo app because mobile cameras were low quality — filters masked the low resolution. Wikipedia succeeded partly because its constraint (anyone can edit) forced community governance. SpaceX\'s constraint (reusable rockets to reduce cost) drove innovations that no one had achieved before.',
              },
              {
                type: 'challenge',
                title: 'The Constraint Challenge',
                content: 'Design a mobile app to help students study, but with these constraints: (1) It can have only one screen — no navigation. (2) It cannot use any text longer than 10 words. (3) It must work without internet. These severe constraints force you to be creative about what truly matters. Sketch your design and explain your choices.',
              },
              {
                type: 'reflect',
                title: 'Embracing Limitations',
                content: 'Next time you face a constraint — limited budget, tight deadline, restricted tools — instead of seeing it as an obstacle, try seeing it as a creative catalyst. Ask: "How does this constraint make my solution different and potentially better?" Some of the world\'s most innovative solutions came from people who had no choice but to think differently.',
              },
            ],
            quiz: [
              {
                id: 'q-cbc-1',
                question: 'Why do constraints often INCREASE creativity rather than limit it?',
                options: [
                  'Because people work harder when limited',
                  'Because constraints narrow the solution space and force creative problem-solving within defined boundaries',
                  'Because unlimited resources always lead to bad outcomes',
                  'Because constraints make problems simpler',
                ],
                correctIndex: 1,
                explanation: 'Constraints focus creative energy by narrowing the infinite space of possibilities to a defined problem space. Within these boundaries, the mind is forced to find novel solutions rather than defaulting to the obvious. Too much freedom can actually hinder creativity by causing decision paralysis.',
              },
              {
                id: 'q-cbc-2',
                question: 'How did Instagram\'s early constraint (low-quality mobile cameras) drive innovation?',
                options: [
                  'It did not — low quality was always a problem',
                  'Photo filters were developed to mask low camera quality, which became Instagram\'s defining feature',
                  'They bought better cameras for users',
                  'They only allowed professional photographers to use the app',
                ],
                correctIndex: 1,
                explanation: 'Instagram\'s photo filters were originally a solution to the constraint of low-quality mobile cameras. The filters masked poor image quality while giving photos an artistic aesthetic. This constraint-driven solution became Instagram\'s signature feature and key differentiator.',
              },
              {
                id: 'q-cbc-3',
                question: 'What is the recommended mindset when facing a constraint?',
                options: [
                  'Give up because the constraint makes success impossible',
                  'Ignore the constraint and do what you want',
                  'View it as a creative catalyst and ask how it might make your solution different and potentially better',
                  'Wait until the constraint is removed before starting',
                ],
                correctIndex: 2,
                explanation: 'Reframing constraints as creative catalysts shifts your mindset from frustration to opportunity. Asking "How does this constraint make my solution different?" opens up creative possibilities that might never emerge under unlimited conditions.',
              },
            ],
          },
          {
            id: 'innovation-project',
            title: 'Your Innovation Project',
            subtitle: 'Applying everything you have learned',
            xpReward: 50,
            durationMinutes: 15,
            sections: [
              {
                type: 'learn',
                title: 'From Thinker to Doer',
                content: 'Throughout this track, you have developed critical thinking, empathy, argumentation, systems thinking, ethics, and creative problem-solving skills. Now it is time to apply them all to a real project. The best way to solidify learning is to use it. Choose a problem that matters to you and apply the full toolkit to develop and present a solution.',
                bulletPoints: [
                  'Identify a real problem using systems thinking',
                  'Research it using critical thinking and evidence evaluation',
                  'Consider stakeholders using empathy and perspective-taking',
                  'Develop solutions using design thinking and brainstorming',
                  'Evaluate your solution using ethical frameworks',
                ],
              },
              {
                type: 'explore',
                title: 'Project Ideas',
                content: 'Consider these starting points: Design an AI tool that helps bridge a digital divide in your community. Create a media literacy workshop for younger students. Propose a policy for ethical AI use at your school. Design an app that promotes empathy in online interactions. Build a systems map of a problem in your community and identify leverage points for change.',
              },
              {
                type: 'challenge',
                title: 'Execute Your Project',
                content: 'Choose your project and work through these steps: (1) Empathize with the people affected. (2) Define the problem clearly. (3) Research using strong evidence. (4) Brainstorm solutions. (5) Prototype your best idea. (6) Conduct a stakeholder analysis. (7) Evaluate ethical implications. (8) Present your solution to others and gather feedback. Document your entire process.',
              },
              {
                type: 'connect',
                title: 'You Are Ready',
                content: 'By completing this project, you have demonstrated that you can think critically, empathize deeply, argue fairly, see systems, reason ethically, and create innovatively. These skills are not just academic — they are the skills the world desperately needs as we navigate the challenges and opportunities of the AI age. You are ready to make a difference.',
              },
            ],
            quiz: [
              {
                id: 'q-ip-1',
                question: 'What is the recommended first step when starting an innovation project?',
                options: [
                  'Build the solution immediately',
                  'Identify and deeply understand the problem and the people affected',
                  'Write a business plan',
                  'Choose the most advanced technology to use',
                ],
                correctIndex: 1,
                explanation: 'Understanding the problem and the people affected is always the foundation. Design thinking starts with empathy, and systems thinking starts with mapping the system. Without deep understanding, even technically brilliant solutions can miss the mark or cause unintended harm.',
              },
              {
                id: 'q-ip-2',
                question: 'Why should you evaluate your solution using ethical frameworks?',
                options: [
                  'To make the project longer',
                  'To ensure your solution does not create new harms and serves all stakeholders fairly',
                  'Because ethics are required for a passing grade',
                  'To prove that your solution is perfect',
                ],
                correctIndex: 1,
                explanation: 'Ethical evaluation helps you identify potential harms, consider fairness across different groups, and ensure your solution aligns with important values. Many well-intentioned projects have caused unintended harm because ethical implications were not considered during development.',
              },
              {
                id: 'q-ip-3',
                question: 'What is the most important outcome of completing an innovation project?',
                options: [
                  'Getting a perfect grade',
                  'Making money from the project',
                  'Integrating and applying critical thinking, empathy, ethics, and creative skills to solve a real problem',
                  'Impressing your teachers',
                ],
                correctIndex: 2,
                explanation: 'The most valuable outcome is the integration of skills. Applying critical thinking, empathy, ethical reasoning, systems thinking, and creative problem-solving together to address a real problem demonstrates genuine competence and prepares you for the complex challenges of the real world.',
              },
            ],
          },
        ],
      },
    ],
  },
];

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

export function getTrack(trackId: string): Track | undefined {
  return TRACKS.find(t => t.id === trackId);
}

export function getModule(trackId: string, moduleId: string): Module | undefined {
  return getTrack(trackId)?.modules.find(m => m.id === moduleId);
}

export function getLesson(trackId: string, moduleId: string, lessonId: string): Lesson | undefined {
  return getModule(trackId, moduleId)?.lessons.find(l => l.id === lessonId);
}

export function getTotalLessons(track: Track): number {
  return track.modules.reduce((sum, m) => sum + m.lessons.length, 0);
}

export function getTotalXP(track: Track): number {
  return track.modules.reduce((sum, m) => sum + m.lessons.reduce((ls, l) => ls + l.xpReward, 0), 0);
}
