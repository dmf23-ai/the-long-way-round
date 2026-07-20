/* The curated "Surprise me" pool. Each entry is either:
     · a bare string  — resolved live by test/audit-seeds.mjs (the same
       resolver the app uses); the audit fails if it hits a known search
       trap (family name, disambiguation, album/single, video game), OR
     · a [displayLabel, 'Qid'] tuple — a human-verified pin, used when the
       plain word misresolves (e.g. "Petra" → a 2018 film) or to prettify
       a scientific-binomial label ("Apis mellifera" → "honeybee").
   Edit here, then run `node test/audit-seeds.mjs` to regenerate js/seeds.js.
   Aim: concrete, globally recognizable, resolvable, spread across eras and
   continents, delightful as a journey endpoint. */

export const SEED_NAMES = [
  // ── scientists, inventors, thinkers ──
  'Marie Curie', 'Alan Turing', 'Isaac Newton', 'Charles Darwin', 'Nikola Tesla',
  'Ada Lovelace', 'Albert Einstein', 'Galileo Galilei', 'Rosalind Franklin',
  'Grace Hopper', 'Katherine Johnson', 'Carl Sagan', 'Jane Goodall', 'Louis Pasteur',
  'Gregor Mendel', 'Emmy Noether', 'Srinivasa Ramanujan', 'Hypatia', 'Tycho Brahe',
  'Dmitri Mendeleev', 'Michael Faraday', 'Alexander von Humboldt', 'Rachel Carson',
  'Barbara McClintock', 'Leonardo da Vinci', 'Archimedes', 'Aristotle', 'Confucius',
  ['Avicenna', 'Q8011'], ['al-Khwarizmi', 'Q9038'],
  // ── artists, composers, writers ──
  'Vincent van Gogh', 'Frida Kahlo', 'Pablo Picasso', 'Claude Monet', 'Salvador Dalí',
  'Hokusai', 'Georgia O’Keeffe', 'Rembrandt', 'Michelangelo', 'Wassily Kandinsky',
  'Johann Sebastian Bach', 'Ludwig van Beethoven', 'Wolfgang Amadeus Mozart',
  'Igor Stravinsky', 'Duke Ellington', 'Miles Davis', 'Louis Armstrong', 'Nina Simone',
  'Aretha Franklin', 'David Bowie', 'Freddie Mercury', 'Bob Dylan', 'Johnny Cash',
  'William Shakespeare', 'Jane Austen', 'Leo Tolstoy', 'Gabriel García Márquez',
  'Maya Angelou', 'Jorge Luis Borges', 'Virginia Woolf', 'Franz Kafka', 'Homer',
  'Toni Morrison', 'Hayao Miyazaki', 'Alfred Hitchcock', 'Charlie Chaplin',
  'Akira Kurosawa',
  // ── rulers, leaders, explorers ──
  'Cleopatra', 'Genghis Khan', 'Julius Caesar', 'Napoleon', ['Queen Victoria', 'Q9439'],
  'Nelson Mandela', 'Mahatma Gandhi', 'Abraham Lincoln', 'Catherine the Great',
  'Ashoka', 'Mansa Musa', 'Qin Shi Huang', ['Elizabeth I', 'Q7207'], 'Sun Tzu', 'Hannibal',
  'Joan of Arc', 'Sitting Bull', 'Harriet Tubman', 'Frederick Douglass',
  'Ernest Shackleton', 'Ferdinand Magellan', 'Zheng He', 'Amelia Earhart',
  'Roald Amundsen', 'Ibn Battuta', 'Marco Polo', 'Sacagawea', 'Yuri Gagarin',
  'Neil Armstrong', 'Sally Ride',
  // ── foods & drinks ──
  'croissant', 'sushi', 'pizza', 'chocolate', 'coffee', 'tea', 'maple syrup',
  'sourdough', 'kimchi', 'hummus', ['paella', 'Q212121'], 'ramen', 'baguette',
  ['espresso', 'Q180289'], 'gelato', 'curry', 'tacos', 'dim sum', 'pretzel', 'bagel',
  'honey', 'saffron', 'vanilla', 'cinnamon', 'chili pepper', ['absinthe', 'Q170210'],
  'champagne', 'whisky', 'sake', 'mango',
  // ── instruments & music ──
  'banjo', 'ukulele', 'accordion', 'harmonica', 'saxophone', 'violin', 'cello',
  'bagpipes', 'sitar', 'didgeridoo', 'theremin', 'harpsichord', ['marimba', 'Q220971'],
  'timpani', 'pipe organ', ['flamenco', 'Q9764'], 'tango', 'reggae', 'the blues', 'opera',
  'gospel music', ['bluegrass', 'Q213714'], 'salsa music', 'fado', 'gamelan',
  // ── landmarks & places ──
  'Eiffel Tower', 'Great Wall of China', 'Machu Picchu', ['Petra', 'Q5788'], 'Taj Mahal',
  'Colosseum', 'Stonehenge', 'the Parthenon', 'Angkor Wat', 'Chichen Itza',
  'Mount Everest', 'Niagara Falls', 'the Grand Canyon', 'the Sahara', 'Antarctica',
  'Mount Fuji', 'the Amazon River', 'the Nile', 'the Dead Sea', 'Lake Baikal',
  'Venice', 'Istanbul', 'Kyoto', 'Marrakesh', 'Timbuktu', 'the Galápagos Islands',
  'Route 66', 'the Trans-Siberian Railway', 'the Great Barrier Reef', 'Easter Island',
  // ── animals & plants ──
  'platypus', ['octopus', 'Q40152'], 'axolotl', 'narwhal', ['pangolin', 'Q25397'],
  'tardigrade', 'jellyfish', ['honeybee', 'Q30034'], ['monarch butterfly', 'Q212398'],
  ['peacock', 'Q201251'], 'komodo dragon', ['blue whale', 'Q42196'], 'giant panda',
  'chameleon', ['seahorse', 'Q11709836'], ['firefly', 'Q25420'], 'coral', 'mushroom',
  ['Venus flytrap', 'Q155825'], ['giant sequoia', 'Q149851'], ['bamboo', 'Q670887'],
  'sunflower', 'orchid', ['baobab', 'Q131825'], ['lotus', 'Q16528'], 'dandelion',
  'kelp', 'lichen', 'cactus',
  // ── inventions & everyday objects ──
  'typewriter', 'bubble wrap', 'lighthouse', 'compass', 'telescope', 'microscope',
  'printing press', 'the wheel', 'penicillin', 'the light bulb', 'the telephone',
  'the bicycle', 'the camera', 'the clock', 'gunpowder', 'paper', 'soap', 'the zipper',
  'Velcro', 'the umbrella', 'the mirror', 'scissors', 'the pencil', 'dynamite',
  'the sewing machine', 'the refrigerator', ['parachute', 'Q482816'], 'Morse code',
  'the barometer', 'the seismograph',
  // ── events & eras ──
  'French Revolution', 'the Renaissance', 'the Silk Road', 'the Industrial Revolution',
  'the Moon landing', 'the Cold War', ['the California Gold Rush', 'Q17550'],
  'the Black Death', 'the Ice Age', 'the Big Bang', 'the fall of the Berlin Wall',
  'the Space Race', 'Prohibition', 'the Enlightenment', 'the Ottoman Empire',
  'the Roman Empire', 'the Byzantine Empire', 'the Ming dynasty', 'the Aztec Empire',
  'the Inca Empire',
  // ── artworks, stories, characters ──
  'The Starry Night', 'the Mona Lisa', 'The Scream', 'the Rosetta Stone',
  'the Venus de Milo', 'the Terracotta Army', 'Sherlock Holmes', 'Don Quixote',
  'Dracula', ['Frankenstein', 'Q2021531'], 'Moby-Dick', ['The Odyssey', 'Q35160'],
  'Hamlet', 'Alice in Wonderland', ['Pinocchio', 'Q8065468'], 'King Arthur',
  'Robin Hood', 'Godzilla', 'James Bond',
  // ── games & pastimes ──
  'chess', 'go', 'poker', 'mahjong', 'origami', 'crossword', 'the Rubik’s Cube',
  ['pinball', 'Q653928'], 'roller coaster', 'the Ferris wheel', 'juggling',
  ['tarot', 'Q583269'], 'dominoes', 'backgammon', 'the yo-yo', 'Lego',
  'the jigsaw puzzle', ['Tetris', 'Q71910'], 'Pac-Man',
  // ── science & sky ──
  'black hole', 'Saturn', 'the Moon', 'the Sun', ['Halley’s Comet', 'Q23054'],
  ['the aurora', 'Q40609'], 'Voyager 1', 'the Hubble Space Telescope',
  'the International Space Station', ['DNA', 'Q7430'], ['the atom', 'Q9121'], 'gravity',
  'electricity', ['the rainbow', 'Q1052'], 'lightning', 'a volcano', 'an earthquake',
  'a glacier', 'a supernova', 'the Milky Way', 'a comet', 'quartz', 'a diamond',
  'amber', 'a meteorite',
  // ── crafts, textiles, symbols ──
  'kimono', 'tartan', 'silk', 'denim', 'lace', 'pottery', 'calligraphy', 'stained glass',
  'the mosaic', 'tattoo', 'perfume', 'the windmill', 'the sundial', 'the abacus',
  'the loom', 'batik', ['the quilt', 'Q1064538'], 'papyrus', ['the hourglass', 'Q179904'],
  ['the anchor', 'Q168432'], ['a totem pole', 'Q83809'], ['a crystal ball', 'Q1032349'],
  // ── myths, folklore, the strange ──
  'the dragon', 'the unicorn', 'the mermaid', ['the labyrinth', 'Q48963'],
  ['the sphinx', 'Q151480'], ['the golem', 'Q215085'], ['the kraken', 'Q193165'],
  'Atlantis', 'the Loch Ness Monster', 'Bigfoot', 'the yeti', 'the vampire',
  'the werewolf', 'the ghost', 'alchemy', 'the compass rose', 'the four-leaf clover',
];
