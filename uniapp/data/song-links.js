// data/song-links.js - 英文名曲歌名表（内置 · 离线可用）
//
// 干什么用的：首页「今日歌曲」卡把**用户词书里的词**和**真实存在的英文歌名**对上，
// 用一首歌帮着记住一个词 —— 歌名里就有那个词（Yesterday / Money / Thunder …）。
//
// 为什么是内置表而不是让 AI 现编：
//   大模型的强项恰恰在这里是致命伤 —— 它会**编造**歌名和歌手，编出来的名字看着很像，
//   用户去音乐 App 一搜搜不到，这条推荐就变成一次欺骗。所以全部写死在这张表里，
//   表里的每一首都是可核实的真实歌曲，改表 = 改数据，AI 碰不到。
//
// 版权边界（重要，改这张表前请先确认自己没越界）：
//   · 歌名 + 演唱者 = 事实性短标题，不构成作品，可以展示
//   · **不播放、不内嵌音频、不给歌词、不给专辑封面**
//     播放要录音制作者权 + 表演者权授权；歌词是文字作品；封面是美术作品
//   · 所以这里只做「告诉你有这么一首歌」，用户自己去音乐 App 搜
//
// 格式：'歌名|演唱者'。加歌请按歌手分组追加，别插到中间 —— 顺序无所谓，
// 但混着写下次没人敢改。
const SONG_RAW = [
  // ---- The Beatles ----
  'Yesterday|The Beatles', 'Let It Be|The Beatles', 'Hey Jude|The Beatles',
  'Help|The Beatles', 'Come Together|The Beatles', 'Something|The Beatles',
  'Revolution|The Beatles', 'Here Comes the Sun|The Beatles', 'In My Life|The Beatles',
  'Norwegian Wood|The Beatles', 'Across the Universe|The Beatles',
  'All You Need Is Love|The Beatles', 'Strawberry Fields Forever|The Beatles',
  'Ticket to Ride|The Beatles', 'Eleanor Rigby|The Beatles', 'Penny Lane|The Beatles',
  'Blackbird|The Beatles', 'Lucy in the Sky with Diamonds|The Beatles',
  'While My Guitar Gently Weeps|The Beatles', 'A Day in the Life|The Beatles',
  'Twist and Shout|The Beatles', 'I Want to Hold Your Hand|The Beatles',
  'She Loves You|The Beatles', 'Eight Days a Week|The Beatles',
  "Can't Buy Me Love|The Beatles", 'Drive My Car|The Beatles',
  'Yellow Submarine|The Beatles', 'Get Back|The Beatles', 'Michelle|The Beatles',
  'I Am the Walrus|The Beatles', 'Day Tripper|The Beatles',
  'We Can Work It Out|The Beatles', 'Paperback Writer|The Beatles',
  'Rain|The Beatles', 'Hello Goodbye|The Beatles',
  'Magical Mystery Tour|The Beatles', 'The Fool on the Hill|The Beatles',
  'Lady Madonna|The Beatles', 'Because|The Beatles', 'Sun King|The Beatles',
  // ---- John Lennon / Paul McCartney ----
  'Imagine|John Lennon', 'Instant Karma|John Lennon', 'Jealous Guy|John Lennon',
  'Working Class Hero|John Lennon', 'Give Peace a Chance|John Lennon',
  'Woman|John Lennon', 'Mind Games|John Lennon', 'Mother|John Lennon',
  'Maybe I’m Amazed|Paul McCartney', 'Band on the Run|Paul McCartney & Wings',
  'Live and Let Die|Paul McCartney & Wings', 'Jet|Paul McCartney & Wings',
  // ---- Queen ----
  'Bohemian Rhapsody|Queen', 'Under Pressure|Queen & David Bowie',
  'We Will Rock You|Queen', 'We Are the Champions|Queen',
  "Somebody to Love|Queen", "Don't Stop Me Now|Queen",
  'Killer Queen|Queen', 'Another One Bites the Dust|Queen',
  'Radio Ga Ga|Queen', 'I Want to Break Free|Queen',
  'Crazy Little Thing Called Love|Queen', 'The Show Must Go On|Queen',
  'Who Wants to Live Forever|Queen', 'Seven Seas of Rhye|Queen',
  // ---- Michael Jackson ----
  'Billie Jean|Michael Jackson', 'Beat It|Michael Jackson',
  'Thriller|Michael Jackson', 'Smooth Criminal|Michael Jackson',
  'Bad|Michael Jackson', 'Dangerous|Michael Jackson',
  'Heal the World|Michael Jackson', 'Earth Song|Michael Jackson',
  'Black or White|Michael Jackson', 'Man in the Mirror|Michael Jackson',
  'Rock with You|Michael Jackson', "Don't Stop 'Til You Get Enough|Michael Jackson",
  'The Way You Make Me Feel|Michael Jackson', 'Leave Me Alone|Michael Jackson',
  'Remember the Time|Michael Jackson', 'You Are Not Alone|Michael Jackson',
  'They Don’t Care About Us|Michael Jackson', 'Scream|Michael Jackson',
  // ---- Ed Sheeran ----
  'Perfect|Ed Sheeran', 'Shape of You|Ed Sheeran', 'Thinking Out Loud|Ed Sheeran',
  'Photograph|Ed Sheeran', 'Castle on the Hill|Ed Sheeran', 'I See Fire|Ed Sheeran',
  'Galway Girl|Ed Sheeran', 'Happier|Ed Sheeran', 'Bad Habits|Ed Sheeran',
  'Shivers|Ed Sheeran', 'The A Team|Ed Sheeran', 'Lego House|Ed Sheeran',
  'Give Me Love|Ed Sheeran', 'Drunk|Ed Sheeran', 'Sing|Ed Sheeran',
  'Bloodstream|Ed Sheeran', 'Eyes Closed|Ed Sheeran', 'Beautiful People|Ed Sheeran',
  // ---- Adele ----
  'Hello|Adele', 'Someone Like You|Adele', 'Rolling in the Deep|Adele',
  'Skyfall|Adele', 'Set Fire to the Rain|Adele', 'Chasing Pavements|Adele',
  'Send My Love|Adele', 'Rumour Has It|Adele', 'Turning Tables|Adele',
  'Make You Feel My Love|Adele', 'Water Under the Bridge|Adele',
  'Easy on Me|Adele', 'Oh My God|Adele',
  // ---- Coldplay ----
  'Viva La Vida|Coldplay', 'Yellow|Coldplay', 'The Scientist|Coldplay',
  'Fix You|Coldplay', 'Clocks|Coldplay', 'Paradise|Coldplay',
  'Speed of Sound|Coldplay', 'Hymn for the Weekend|Coldplay',
  'A Sky Full of Stars|Coldplay', 'Adventure of a Lifetime|Coldplay',
  'Something Just Like This|Coldplay', 'Everglow|Coldplay', 'Magic|Coldplay',
  'Charlie Brown|Coldplay', 'My Universe|Coldplay', 'Higher Power|Coldplay',
  'Orphans|Coldplay', 'Warning Sign|Coldplay', 'Trouble|Coldplay',
  // ---- Oasis ----
  'Wonderwall|Oasis', 'Champagne Supernova|Oasis', "Don't Look Back in Anger|Oasis",
  'Live Forever|Oasis', 'Roll with It|Oasis', 'Some Might Say|Oasis',
  'Morning Glory|Oasis', 'Stop Crying Your Heart Out|Oasis',
  'Little by Little|Oasis', 'The Importance of Being Idle|Oasis',
  // ---- Radiohead ----
  'Creep|Radiohead', 'Karma Police|Radiohead', 'No Surprises|Radiohead',
  'Fake Plastic Trees|Radiohead', 'High and Dry|Radiohead',
  'Paranoid Android|Radiohead', 'Let Down|Radiohead', 'Street Spirit|Radiohead',
  // ---- Katy Perry ----
  'Firework|Katy Perry', 'Roar|Katy Perry', 'Teenage Dream|Katy Perry',
  'Dark Horse|Katy Perry', 'California Gurls|Katy Perry',
  'I Kissed a Girl|Katy Perry', 'Hot n Cold|Katy Perry', 'Wide Awake|Katy Perry',
  'Part of Me|Katy Perry', 'Last Friday Night|Katy Perry',
  'The One That Got Away|Katy Perry', 'Chained to the Rhythm|Katy Perry',
  // ---- Lady Gaga ----
  'Bad Romance|Lady Gaga', 'Poker Face|Lady Gaga', 'Just Dance|Lady Gaga',
  'Telephone|Lady Gaga', 'Born This Way|Lady Gaga', 'Million Reasons|Lady Gaga',
  'Shallow|Lady Gaga & Bradley Cooper', 'Alejandro|Lady Gaga',
  'Paparazzi|Lady Gaga', 'Rain on Me|Lady Gaga', 'The Edge of Glory|Lady Gaga',
  'Applause|Lady Gaga', 'Judas|Lady Gaga', 'Hold My Hand|Lady Gaga',
  // ---- Imagine Dragons ----
  'Radioactive|Imagine Dragons', 'Demons|Imagine Dragons', 'Believer|Imagine Dragons',
  'Thunder|Imagine Dragons', 'Natural|Imagine Dragons',
  'Whatever It Takes|Imagine Dragons', 'Warriors|Imagine Dragons',
  'I Bet My Life|Imagine Dragons', 'On Top of the World|Imagine Dragons',
  "It's Time|Imagine Dragons", 'Amsterdam|Imagine Dragons', 'Enemy|Imagine Dragons',
  'Bones|Imagine Dragons',
  // ---- Maroon 5 ----
  'Memories|Maroon 5', 'Sugar|Maroon 5', 'Animals|Maroon 5',
  'Payphone|Maroon 5', 'Moves like Jagger|Maroon 5',
  'She Will Be Loved|Maroon 5', 'This Love|Maroon 5',
  'Sunday Morning|Maroon 5', 'One More Night|Maroon 5',
  'Girls Like You|Maroon 5', 'Wait|Maroon 5',
  // ---- The Weeknd ----
  'Blinding Lights|The Weeknd', 'Save Your Tears|The Weeknd',
  'Starboy|The Weeknd', "Can't Feel My Face|The Weeknd", 'The Hills|The Weeknd',
  'Earned It|The Weeknd', 'I Feel It Coming|The Weeknd',
  'Die for You|The Weeknd', 'Take My Breath|The Weeknd',
  'After Hours|The Weeknd', 'Heartless|The Weeknd',
  // ---- Billie Eilish ----
  'Bad Guy|Billie Eilish', 'Bury a Friend|Billie Eilish',
  'Ocean Eyes|Billie Eilish', 'Lovely|Billie Eilish & Khalid',
  "When the Party's Over|Billie Eilish", 'Everything I Wanted|Billie Eilish',
  'Therefore I Am|Billie Eilish', 'My Future|Billie Eilish',
  'No Time to Die|Billie Eilish', 'Happier Than Ever|Billie Eilish',
  'What Was I Made For|Billie Eilish', 'Birds of a Feather|Billie Eilish',
  // ---- Post Malone ----
  'Circles|Post Malone', 'Sunflower|Post Malone & Swae Lee',
  'Rockstar|Post Malone', 'Congratulations|Post Malone',
  'Better Now|Post Malone', 'Psycho|Post Malone', 'White Iverson|Post Malone',
  'I Fall Apart|Post Malone', 'Wow|Post Malone',
  // ---- Dua Lipa ----
  "Don't Start Now|Dua Lipa", 'Levitating|Dua Lipa', 'Physical|Dua Lipa',
  'Break My Heart|Dua Lipa', 'New Rules|Dua Lipa', 'IDGAF|Dua Lipa',
  'One Kiss|Dua Lipa', 'Electricity|Dua Lipa', 'Hallucinate|Dua Lipa',
  'Love Again|Dua Lipa', 'Cool|Dua Lipa',
  // ---- Harry Styles ----
  'Watermelon Sugar|Harry Styles', 'Adore You|Harry Styles',
  'Falling|Harry Styles', 'Golden|Harry Styles',
  'Sign of the Times|Harry Styles', 'As It Was|Harry Styles',
  'Late Night Talking|Harry Styles', 'Satellite|Harry Styles',
  'Matilda|Harry Styles', 'Fine Line|Harry Styles', 'Cherry|Harry Styles',
  'Sweet Creature|Harry Styles', 'Kiwi|Harry Styles',
  'Music for a Sushi Restaurant|Harry Styles', 'Daylight|Harry Styles',
  // ---- Taylor Swift ----
  'August|Taylor Swift', 'Blank Space|Taylor Swift', 'Shake It Off|Taylor Swift',
  'Bad Blood|Taylor Swift', 'Style|Taylor Swift', 'Wildest Dreams|Taylor Swift',
  'Delicate|Taylor Swift', 'Cardigan|Taylor Swift', 'Willow|Taylor Swift',
  'Love Story|Taylor Swift', 'You Belong with Me|Taylor Swift',
  'Fifteen|Taylor Swift', 'Mean|Taylor Swift', 'Mine|Taylor Swift',
  'Back to December|Taylor Swift', 'Speak Now|Taylor Swift', 'Red|Taylor Swift',
  'All Too Well|Taylor Swift', 'Anti-Hero|Taylor Swift',
  'Cruel Summer|Taylor Swift', 'Lavender Haze|Taylor Swift',
  'Enchanted|Taylor Swift', 'Long Live|Taylor Swift',
  'State of Grace|Taylor Swift', 'Begin Again|Taylor Swift',
  'Out of the Woods|Taylor Swift', 'New Romantics|Taylor Swift',
  'Ready for It|Taylor Swift', 'Gorgeous|Taylor Swift', 'Lover|Taylor Swift',
  'The Archer|Taylor Swift', 'Exile|Taylor Swift', 'Betty|Taylor Swift',
  'The Last Great American Dynasty|Taylor Swift',
  // ---- The Police ----
  'Message in a Bottle|The Police', 'Every Breath You Take|The Police',
  'Roxanne|The Police', 'Walking on the Moon|The Police', 'So Lonely|The Police',
  "Don't Stand So Close to Me|The Police", 'King of Pain|The Police',
  // ---- Lana Del Rey ----
  'Born to Die|Lana Del Rey', 'Video Games|Lana Del Rey',
  'Summertime Sadness|Lana Del Rey', 'Blue Jeans|Lana Del Rey',
  'Young and Beautiful|Lana Del Rey', 'West Coast|Lana Del Rey',
  'Ride|Lana Del Rey', 'Ultraviolence|Lana Del Rey',
  'Brooklyn Baby|Lana Del Rey', 'Honeymoon|Lana Del Rey',
  // ---- Guns N' Roses / AC/DC / 硬摇 ----
  'November Rain|Guns N’ Roses', 'Sweet Child O’ Mine|Guns N’ Roses',
  'Paradise City|Guns N’ Roses', "Knockin' on Heaven's Door|Guns N’ Roses",
  'Welcome to the Jungle|Guns N’ Roses', 'Patience|Guns N’ Roses',
  "Don't Cry|Guns N’ Roses", 'Civil War|Guns N’ Roses',
  'Thunderstruck|AC/DC', 'Highway to Hell|AC/DC', 'Back in Black|AC/DC',
  'Hells Bells|AC/DC', 'You Shook Me All Night Long|AC/DC',
  'Stairway to Heaven|Led Zeppelin', 'Whole Lotta Love|Led Zeppelin',
  'Kashmir|Led Zeppelin', 'Black Dog|Led Zeppelin', 'Immigrant Song|Led Zeppelin',
  'Ramble On|Led Zeppelin', 'The Rain Song|Led Zeppelin', 'No Quarter|Led Zeppelin',
  'Free Bird|Lynyrd Skynyrd', 'Sweet Home Alabama|Lynyrd Skynyrd',
  // ---- a-ha / Avril / The Killers / Linkin Park ----
  'Take On Me|a-ha', 'Hunting High and Low|a-ha',
  'Complicated|Avril Lavigne', 'Sk8er Boi|Avril Lavigne',
  'Girlfriend|Avril Lavigne', "I'm With You|Avril Lavigne",
  'My Happy Ending|Avril Lavigne', "When You're Gone|Avril Lavigne",
  'Mr Brightside|The Killers', 'Somebody Told Me|The Killers',
  'Human|The Killers', 'When You Were Young|The Killers',
  'Read My Mind|The Killers', 'Runaways|The Killers', 'The Man|The Killers',
  'Numb|Linkin Park', 'In the End|Linkin Park', 'Crawling|Linkin Park',
  'Faint|Linkin Park', 'One Step Closer|Linkin Park', 'Given Up|Linkin Park',
  "What I've Done|Linkin Park", 'Bleed It Out|Linkin Park',
  'Shadow of the Day|Linkin Park', 'Papercut|Linkin Park',
  'One More Light|Linkin Park', 'Castle of Glass|Linkin Park',
  'Burn It Down|Linkin Park',
  // ---- Avicii / OneRepublic / 电音 ----
  'Wake Me Up|Avicii', 'Hey Brother|Avicii', 'Levels|Avicii',
  'The Nights|Avicii', 'Waiting for Love|Avicii', 'Without You|Avicii',
  'SOS|Avicii', 'Lonely Together|Avicii',
  'Counting Stars|OneRepublic', 'Apologize|OneRepublic',
  'Stop and Stare|OneRepublic', 'Secrets|OneRepublic', 'Good Life|OneRepublic',
  'I Lived|OneRepublic', 'Rescue Me|OneRepublic',
  'Closer|The Chainsmokers', "Don't Let Me Down|The Chainsmokers",
  'Roses|The Chainsmokers',
  // ---- David Bowie ----
  'Heroes|David Bowie', 'Space Oddity|David Bowie', 'Changes|David Bowie',
  "Let's Dance|David Bowie", 'Fame|David Bowie', 'Rebel Rebel|David Bowie',
  'Ziggy Stardust|David Bowie', 'Life on Mars|David Bowie',
  'Starman|David Bowie', 'Golden Years|David Bowie',
  'Ashes to Ashes|David Bowie', 'Modern Love|David Bowie',
  'The Man Who Sold the World|David Bowie', 'Young Americans|David Bowie',
  'Fashion|David Bowie',
  // ---- Pink Floyd ----
  'Money|Pink Floyd', 'Wish You Were Here|Pink Floyd',
  'Another Brick in the Wall|Pink Floyd', 'Comfortably Numb|Pink Floyd',
  'Time|Pink Floyd', 'Hey You|Pink Floyd', 'Us and Them|Pink Floyd',
  'Brain Damage|Pink Floyd', 'Eclipse|Pink Floyd', 'Learning to Fly|Pink Floyd',
  'High Hopes|Pink Floyd', 'Breathe|Pink Floyd', 'Mother|Pink Floyd',
  'Shine On You Crazy Diamond|Pink Floyd',
  // ---- Green Day / Nirvana / 另类 ----
  'Boulevard of Broken Dreams|Green Day',
  'Wake Me Up When September Ends|Green Day', 'American Idiot|Green Day',
  'Holiday|Green Day', 'Basket Case|Green Day',
  'Good Riddance (Time of Your Life)|Green Day', 'When I Come Around|Green Day',
  'Minority|Green Day', '21 Guns|Green Day',
  'Smells Like Teen Spirit|Nirvana', 'Come As You Are|Nirvana',
  'Lithium|Nirvana', 'Heart-Shaped Box|Nirvana', 'About a Girl|Nirvana',
  'In Bloom|Nirvana', 'All Apologies|Nirvana',
  'Zombie|The Cranberries', 'Linger|The Cranberries', 'Dreams|The Cranberries',
  'Ode to My Family|The Cranberries', 'Salvation|The Cranberries',
  'Chasing Cars|Snow Patrol', 'Run|Snow Patrol', 'Chocolate|Snow Patrol',
  'Seven Nation Army|The White Stripes', 'Fell in Love with a Girl|The White Stripes',
  'Icky Thump|The White Stripes', 'Blue Orchid|The White Stripes',
  // ---- Bon Jovi / Journey / Springsteen ----
  "Livin' on a Prayer|Bon Jovi", "You Give Love a Bad Name|Bon Jovi",
  "It's My Life|Bon Jovi", 'Always|Bon Jovi', 'Bed of Roses|Bon Jovi',
  'Runaway|Bon Jovi', 'Wanted Dead or Alive|Bon Jovi',
  'Blaze of Glory|Bon Jovi', 'Keep the Faith|Bon Jovi', 'Bad Medicine|Bon Jovi',
  "Don't Stop Believin'|Journey", 'Open Arms|Journey', 'Wheel in the Sky|Journey',
  'Separate Ways|Journey', 'Faithfully|Journey', 'Lights|Journey',
  'Born in the U.S.A.|Bruce Springsteen', 'Dancing in the Dark|Bruce Springsteen',
  'Born to Run|Bruce Springsteen', 'Thunder Road|Bruce Springsteen',
  'Glory Days|Bruce Springsteen', "I'm on Fire|Bruce Springsteen",
  'Hungry Heart|Bruce Springsteen', 'The River|Bruce Springsteen',
  'Streets of Philadelphia|Bruce Springsteen', 'My Hometown|Bruce Springsteen',
  // ---- U2 / The Rolling Stones / The Doors ----
  'With or Without You|U2', 'One|U2', 'Where the Streets Have No Name|U2',
  'Sunday Bloody Sunday|U2', 'Beautiful Day|U2', 'Desire|U2',
  'Mysterious Ways|U2', 'Elevation|U2', 'Vertigo|U2', "New Year's Day|U2",
  'I Still Haven’t Found What I’m Looking For|U2',
  "Sometimes You Can't Make It on Your Own|U2", "All I Want Is You|U2",
  'I Will Follow|U2', 'Gloria|U2', 'Bad|U2',
  'Paint It Black|The Rolling Stones', 'Sympathy for the Devil|The Rolling Stones',
  'Gimme Shelter|The Rolling Stones', 'Angie|The Rolling Stones',
  'Wild Horses|The Rolling Stones', 'Start Me Up|The Rolling Stones',
  'Ruby Tuesday|The Rolling Stones', "Jumpin' Jack Flash|The Rolling Stones",
  'Honky Tonk Women|The Rolling Stones', 'Brown Sugar|The Rolling Stones',
  'Miss You|The Rolling Stones', 'Tumbling Dice|The Rolling Stones',
  'Beast of Burden|The Rolling Stones', 'Waiting on a Friend|The Rolling Stones',
  'Light My Fire|The Doors', 'Riders on the Storm|The Doors',
  'Break On Through|The Doors', 'People Are Strange|The Doors',
  'Love Her Madly|The Doors', 'Hello I Love You|The Doors',
  'LA Woman|The Doors', 'Roadhouse Blues|The Doors', 'Strange Days|The Doors',
  // ---- Eagles / Elton John / Fleetwood Mac ----
  'Hotel California|Eagles', 'Take It Easy|Eagles', 'Desperado|Eagles',
  'Lyin’ Eyes|Eagles', 'One of These Nights|Eagles',
  'Peaceful Easy Feeling|Eagles', 'New Kid in Town|Eagles',
  'Life in the Fast Lane|Eagles', 'Tequila Sunrise|Eagles',
  'Already Gone|Eagles', 'Witchy Woman|Eagles', 'The Long Run|Eagles',
  'Rocket Man|Elton John', 'Your Song|Elton John', 'Tiny Dancer|Elton John',
  'Candle in the Wind|Elton John', 'Bennie and the Jets|Elton John',
  'Daniel|Elton John', 'Goodbye Yellow Brick Road|Elton John',
  "I'm Still Standing|Elton John",
  "Don't Let the Sun Go Down on Me|Elton John", 'Crocodile Rock|Elton John',
  'Sorry Seems to Be the Hardest Word|Elton John', 'Sacrifice|Elton John',
  'Nikita|Elton John', 'Can You Feel the Love Tonight|Elton John',
  'Dreams|Fleetwood Mac', 'Go Your Own Way|Fleetwood Mac',
  'Rhiannon|Fleetwood Mac', 'Landslide|Fleetwood Mac', 'The Chain|Fleetwood Mac',
  "Don't Stop|Fleetwood Mac", 'Gypsy|Fleetwood Mac', 'Little Lies|Fleetwood Mac',
  'Everywhere|Fleetwood Mac', 'Big Love|Fleetwood Mac', 'Tusk|Fleetwood Mac',
  'Sara|Fleetwood Mac', 'Silver Springs|Fleetwood Mac',
  // ---- ABBA / TLC / Destiny's Child / Beyoncé / Rihanna ----
  'Dancing Queen|ABBA', 'Mamma Mia|ABBA', 'The Winner Takes It All|ABBA',
  'Money Money Money|ABBA', 'Waterloo|ABBA', 'Chiquitita|ABBA',
  'SOS|ABBA', 'Gimme Gimme Gimme|ABBA', 'Knowing Me Knowing You|ABBA',
  'Fernando|ABBA', 'Take a Chance on Me|ABBA', 'Super Trouper|ABBA',
  'The Name of the Game|ABBA', 'Does Your Mother Know|ABBA',
  'I Have a Dream|ABBA', 'Thank You for the Music|ABBA',
  'Waterfalls|TLC', 'No Scrubs|TLC', 'Unpretty|TLC', 'Creep|TLC',
  'Red Light Special|TLC',
  'Survivor|Destiny’s Child', 'Say My Name|Destiny’s Child',
  'Independent Women|Destiny’s Child', 'Bootylicious|Destiny’s Child',
  'Soldier|Destiny’s Child', 'Lose My Breath|Destiny’s Child',
  'Crazy in Love|Beyoncé', 'Single Ladies (Put a Ring on It)|Beyoncé',
  'Halo|Beyoncé', 'Irreplaceable|Beyoncé', 'Formation|Beyoncé',
  'Hold Up|Beyoncé', 'Drunk in Love|Beyoncé', 'XO|Beyoncé',
  'Love on Top|Beyoncé', 'If I Were a Boy|Beyoncé', 'Listen|Beyoncé',
  'Run the World (Girls)|Beyoncé', 'Flawless|Beyoncé', 'Pretty Hurts|Beyoncé',
  'Umbrella|Rihanna', 'Diamonds|Rihanna', 'We Found Love|Rihanna',
  'Only Girl (In the World)|Rihanna', 'Disturbia|Rihanna', 'Take a Bow|Rihanna',
  'Russian Roulette|Rihanna', 'Work|Rihanna', 'Needed Me|Rihanna',
  'Love on the Brain|Rihanna', 'Stay|Rihanna', "Don't Stop the Music|Rihanna",
  'S&M|Rihanna', 'Rude Boy|Rihanna', 'What’s My Name|Rihanna',
  'Man Down|Rihanna', 'Where Have You Been|Rihanna',
  // ---- Sia / Pharrell / Justin Bieber ----
  'Chandelier|Sia', 'Cheap Thrills|Sia', 'Elastic Heart|Sia',
  'Titanium|David Guetta & Sia', 'Unstoppable|Sia', 'Alive|Sia',
  'The Greatest|Sia', 'Move Your Body|Sia', 'Bird Set Free|Sia',
  'Big Girls Cry|Sia', 'Never Give Up|Sia', 'Helium|Sia',
  'Happy|Pharrell Williams', 'Get Lucky|Daft Punk & Pharrell Williams',
  'Freedom|Pharrell Williams',
  'Sorry|Justin Bieber', 'Love Yourself|Justin Bieber',
  'What Do You Mean?|Justin Bieber', 'Baby|Justin Bieber',
  'Boyfriend|Justin Bieber', 'Peaches|Justin Bieber', 'Ghost|Justin Bieber',
  'Stay|Justin Bieber', 'Holy|Justin Bieber', 'Anyone|Justin Bieber',
  'Intentions|Justin Bieber', 'Cold Water|Justin Bieber',
  // ---- 灵魂 / 爵士 / 老歌 ----
  'What a Wonderful World|Louis Armstrong', 'Hello Dolly|Louis Armstrong',
  'When the Saints Go Marching In|Louis Armstrong',
  'Dream a Little Dream of Me|Louis Armstrong', 'Mack the Knife|Louis Armstrong',
  'Unforgettable|Nat King Cole', 'L-O-V-E|Nat King Cole',
  'Mona Lisa|Nat King Cole', 'When I Fall in Love|Nat King Cole',
  'The Christmas Song|Nat King Cole', 'Nature Boy|Nat King Cole',
  'Autumn Leaves|Nat King Cole', 'Smile|Nat King Cole',
  'Feeling Good|Nina Simone', 'Sinnerman|Nina Simone',
  'I Put a Spell on You|Nina Simone', 'My Baby Just Cares for Me|Nina Simone',
  'Strange Fruit|Nina Simone', "Don't Let Me Be Misunderstood|Nina Simone",
  'At Last|Etta James', "I'd Rather Go Blind|Etta James",
  'Stormy Weather|Etta James', 'Tell Mama|Etta James',
  'Respect|Aretha Franklin', 'Chain of Fools|Aretha Franklin',
  'Think|Aretha Franklin', 'I Say a Little Prayer|Aretha Franklin',
  'Spanish Harlem|Aretha Franklin', 'Day Dreaming|Aretha Franklin',
  'A Change Is Gonna Come|Sam Cooke', 'You Send Me|Sam Cooke',
  'Chain Gang|Sam Cooke', 'Bring It on Home to Me|Sam Cooke',
  'Cupid|Sam Cooke', 'Another Saturday Night|Sam Cooke',
  'Sittin’ On the Dock of the Bay|Otis Redding',
  'Try a Little Tenderness|Otis Redding', 'These Arms of Mine|Otis Redding',
  "I've Been Loving You Too Long|Otis Redding",
  'What’s Going On|Marvin Gaye', "Let's Get It On|Marvin Gaye",
  'Sexual Healing|Marvin Gaye', 'I Heard It Through the Grapevine|Marvin Gaye',
  'Ain’t No Mountain High Enough|Marvin Gaye',
  'Mercy Mercy Me|Marvin Gaye', 'Inner City Blues|Marvin Gaye',
  'Superstition|Stevie Wonder', 'Sir Duke|Stevie Wonder',
  'Isn’t She Lovely|Stevie Wonder',
  'I Just Called to Say I Love You|Stevie Wonder',
  'For Once in My Life|Stevie Wonder', 'My Cherie Amour|Stevie Wonder',
  'Signed Sealed Delivered|Stevie Wonder', 'Uptight|Stevie Wonder',
  'Higher Ground|Stevie Wonder', 'Living for the City|Stevie Wonder',
  'You Are the Sunshine of My Life|Stevie Wonder', 'Master Blaster|Stevie Wonder',
  'Overjoyed|Stevie Wonder', 'As|Stevie Wonder', 'Happy Birthday|Stevie Wonder',
  // ---- 流行抒情 / 电影金曲 ----
  'Hero|Mariah Carey', 'All I Want for Christmas Is You|Mariah Carey',
  'Fantasy|Mariah Carey', 'Always Be My Baby|Mariah Carey',
  'Without You|Mariah Carey', 'Vision of Love|Mariah Carey',
  'One Sweet Day|Mariah Carey', 'Honey|Mariah Carey',
  'Dreamlover|Mariah Carey', 'We Belong Together|Mariah Carey',
  'I Will Always Love You|Whitney Houston', 'Greatest Love of All|Whitney Houston',
  'I Wanna Dance with Somebody|Whitney Houston',
  'Saving All My Love for You|Whitney Houston', 'How Will I Know|Whitney Houston',
  'One Moment in Time|Whitney Houston', 'I Have Nothing|Whitney Houston',
  'Run to You|Whitney Houston',
  'My Heart Will Go On|Celine Dion', 'Because You Loved Me|Celine Dion',
  'The Power of Love|Celine Dion', 'Beauty and the Beast|Celine Dion',
  'All by Myself|Celine Dion', "I'm Alive|Celine Dion",
  'A New Day Has Come|Celine Dion',
  'Purple Rain|Prince', 'When Doves Cry|Prince', 'Kiss|Prince',
  '1999|Prince', 'Little Red Corvette|Prince', "Let's Go Crazy|Prince",
  'Cream|Prince', 'Raspberry Beret|Prince',
  'Blowin’ in the Wind|Bob Dylan', 'Like a Rolling Stone|Bob Dylan',
  'The Times They Are a-Changin’|Bob Dylan', 'Mr. Tambourine Man|Bob Dylan',
  'Hurricane|Bob Dylan', 'Just Like a Woman|Bob Dylan', 'Lay Lady Lay|Bob Dylan',
  'Forever Young|Bob Dylan', 'Tangled Up in Blue|Bob Dylan',
  "Don't Think Twice It's All Right|Bob Dylan",
  'Subterranean Homesick Blues|Bob Dylan',
  'The Sound of Silence|Simon & Garfunkel',
  'Bridge over Troubled Water|Simon & Garfunkel', 'Mrs. Robinson|Simon & Garfunkel',
  'The Boxer|Simon & Garfunkel', 'Scarborough Fair|Simon & Garfunkel',
  'Homeward Bound|Simon & Garfunkel', 'Cecilia|Simon & Garfunkel',
  'America|Simon & Garfunkel', 'I Am a Rock|Simon & Garfunkel',
  'My Way|Frank Sinatra', 'New York New York|Frank Sinatra',
  'Fly Me to the Moon|Frank Sinatra', 'Strangers in the Night|Frank Sinatra',
  'The Way You Look Tonight|Frank Sinatra', 'Come Fly with Me|Frank Sinatra',
  "That's Life|Frank Sinatra", 'Let It Snow|Frank Sinatra',
  // ---- 民谣 / 独立 / 近十年 ----
  'Riptide|Vance Joy', 'Ho Hey|The Lumineers', 'Ophelia|The Lumineers',
  'Stubborn Love|The Lumineers', 'Take Me to Church|Hozier',
  'Cherry Wine|Hozier', 'Work Song|Hozier', 'From Eden|Hozier',
  'Wonder|Shawn Mendes', 'In My Blood|Shawn Mendes', 'Mercy|Shawn Mendes',
  'Treat You Better|Shawn Mendes', 'Stitches|Shawn Mendes',
  'Senorita|Shawn Mendes & Camila Cabello', 'Youth|Shawn Mendes',
  'Old Town Road|Lil Nas X', 'Montero|Lil Nas X',
  'Dance Monkey|Tones and I', 'Flowers|Miley Cyrus',
  'Unholy|Sam Smith & Kim Petras', 'Someone You Loved|Lewis Capaldi',
  'Fireflies|Owl City', 'Dream On|Aerosmith', 'Sweet Dreams|Eurythmics',
  'Hallelujah|Leonard Cohen', 'Mad World|Tears for Fears',
  'Wonderful Tonight|Eric Clapton', 'Tears in Heaven|Eric Clapton',
  'Change the World|Eric Clapton', 'Layla|Derek & the Dominos',
  'Cocaine|Eric Clapton', 'Crossroads|Eric Clapton',
  'I Shot the Sheriff|Eric Clapton', 'Bad Love|Eric Clapton',
  'Heaven|Bryan Adams', "Summer of '69|Bryan Adams",
  'Please Forgive Me|Bryan Adams', 'Pressure|Billy Joel',
  'Mirror|Lil Wayne', 'Shower|Becky G', 'Slide|Calvin Harris',
  'Stronger|Kanye West', 'Fighter|Christina Aguilera',
  'Beautiful|Christina Aguilera', 'Angels|Robbie Williams',
  "Freedom! '90|George Michael", 'Faith|George Michael',
  'Torn|Natalie Imbruglia', 'Believe|Cher', 'Genie in a Bottle|Christina Aguilera',
  'Since U Been Gone|Kelly Clarkson', 'Because of You|Kelly Clarkson'
];

// 冠词 / 介词 / 助动词这类词不做推荐落点：
// 它们几乎出现在每一首歌名里（Let It Be、Blowin' in the Wind…），
// 拿它们当"这个词有首歌"毫无信息量，还会把有意思的实词挤掉。
const STOP = {};
([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'without', 'from', 'by', 'as', 'is', 'am', 'are', 'was', 'were',
  'be', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'there', 'here', 'what', 'when', 'where', 'who', 'whom', 'why', 'how',
  'which', 'if', 'so', 'no', 'not', 'nor', 'up', 'out', 'over', 'under',
  'about', 'into', 'than', 'then', 'all', 'any', 'some', 'more', 'most',
  'just', 'only', 'very', 'can', 'will', 'would', 'could', 'should', 'shall',
  'may', 'might', 'must', 'get', 'got', 'go', 'goes', 'going', 'gone', 'come',
  'came', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'let', 'dont', 'aint', 'im', 'ive', 'ill', 'youre', 'thats',
  'wanna', 'gonna', 'gimme', 'la', 'el', 'ya', 'uh', 'oh', 'yeah'
]).forEach(w => { STOP[w] = true; });

let TABLE = null;

/** 歌名 → 可匹配词形（含去复数的还原形，见 singular()） */
function keysOf(song) {
  const s = String(song || '').toLowerCase();
  const raw = s.split(/[^a-z0-9’']+/).filter(Boolean);
  const out = [];
  raw.forEach(w => {
    const bare = w.replace(/^['’]+|['’]+$/g, '').replace(/’/g, "'");
    if (!bare) return;
    push(out, bare);
    const one = singular(bare);
    if (one && one !== bare) push(out, one);
  });
  return out;
}

function push(arr, w) {
  if (arr.indexOf(w) < 0) arr.push(w);
}

/**
 * 极简去复数：只处理 -s / -ies，够用就够。
 * 刻意不引 utils/lemma.js —— 这里是 data 层，不该反向依赖上层的词形模块
 * （那条链上挂着 dict / store，一引进来半个 App 的模块都被拖进首页）。
 */
function singular(w) {
  if (w.length < 4) return '';
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ss|us|is|os)$/.test(w)) return '';
  if (/s$/.test(w)) return w.slice(0, -1);
  return '';
}

/** 解析后的表：{ song, artist, keys, title } —— title = 去冠词的整名小写 */
export function table() {
  if (TABLE) return TABLE;
  TABLE = [];
  SONG_RAW.forEach(line => {
    const i = line.indexOf('|');
    if (i <= 0) return;
    const song = line.slice(0, i).trim();
    const artist = line.slice(i + 1).trim();
    if (!song || !artist) return;
    const title = song
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, '')
      .trim();
    TABLE.push({ song: song, artist: artist, keys: keysOf(song), title: title });
  });
  return TABLE;
}

/** 表里一共多少首 */
export function count() {
  return table().length;
}

// ---------- 反向索引：词形 → 歌 ----------
// 没有这层，每匹配一个词都要把 800 首歌扫一遍；词书近 4000 词 × 800 首 = 三百万次比较，
// 首页一进就卡住。建一次索引（三千来项，几毫秒），之后每个词一次 O(1) 查找。
let INDEX = null;

function index() {
  if (INDEX) return INDEX;
  INDEX = {};
  table().forEach(s => {
    s.keys.forEach(k => put(k, s, 'in'));
    // 整名这条最后放：它比"词出现在歌名里"更有记忆点，要盖掉同词的 in 记录
    put(s.title, s, 'exact');
  });
  return INDEX;
}

function put(k, s, kind) {
  const key = String(k || '').toLowerCase().trim();
  if (key.length < 3 || STOP[key]) return;
  const m = INDEX;
  const arr = m[key] || (m[key] = []);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].song === s.song && arr[i].artist === s.artist) {
      if (kind === 'exact') arr[i] = { song: s.song, artist: s.artist, kind: 'exact' };
      return;
    }
  }
  arr.push({ song: s.song, artist: s.artist, kind: kind });
}

/**
 * 一个词能配上哪些歌。
 * kind: 'exact' = 整首歌名就是这个词（Yesterday / Money / Thunder），
 *       'in'    = 这个词出现在歌名里（Take On Me 里的 take）。
 */
export function matchFor(word) {
  const w = String(word == null ? '' : word).toLowerCase().trim();
  if (w.length < 3 || STOP[w]) return [];
  const arr = index()[w];
  if (!arr || !arr.length) return [];
  // 拷一份再给：索引是共享的，被谁改了一处，后面所有匹配都跟着错
  return arr.map(x => ({ song: x.song, artist: x.artist, kind: x.kind }));
}

/** 只问一句：这个词配得上歌吗（卡片外想快速筛时用） */
export function hasSong(word) {
  return matchFor(word).length > 0;
}

// ---------- 每日推荐 ----------
// 同一天同一批（seed 只含日期），刷新换一批（seed 多带一个 offset）。
// 用固定种子的伪随机而不是 Math.random —— 否则每次进首页歌曲都在跳，
// "今天推荐"就名不副实了。
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 候选池：把词表 × 歌名表展开成 (词, 歌) 配对。
 * words 形如 [{ w: 'money', m: '钱' }] 或 ['money']。
 * 入参顺序可能影响结果 —— 所以内部按词排序，保证同一批词永远得到同一池子。
 */
export function candidates(words) {
  const list = Array.isArray(words) ? words : [];
  const out = [];
  list.forEach(it => {
    const w = String(it && it.w != null ? it.w : it == null ? '' : it).toLowerCase().trim();
    if (!w) return;
    const mean = (it && it.m) || '';
    matchFor(w).forEach(s => {
      out.push({
        word: w,
        mean: mean,
        song: s.song,
        artist: s.artist,
        kind: s.kind,
        key: s.song + '|' + s.artist
      });
    });
  });
  out.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : a.song < b.song ? -1 : 1));
  return out;
}

/**
 * 挑一批推荐。
 * @param words 词表（[{w,m}] 或 [字符串]）
 * @param n     要几首
 * @param seed  任意字符串；同一 seed 必得同一结果
 * 规则：先把"整名就是这个词"的排在前面（exact 更有记忆点），
 * 且一个词只出一首、一首歌只出现一次；实在凑不满才放宽到"一个词两首"。
 */
export function recommend(words, n, seed) {
  const want = n > 0 ? n : 3;
  const pool = candidates(words);
  if (!pool.length) return [];
  const exact = pool.filter(x => x.kind === 'exact');
  const rest = pool.filter(x => x.kind !== 'exact');
  const rnd = rng(hash(String(seed == null ? '' : seed)));
  const order = shuffled(exact, rnd).concat(shuffled(rest, rnd));

  const picked = [];
  const usedWord = {};
  const usedKey = {};
  for (let i = 0; i < order.length && picked.length < want; i++) {
    const it = order[i];
    if (usedKey[it.key] || usedWord[it.word]) continue;
    usedKey[it.key] = true;
    usedWord[it.word] = true;
    picked.push(it);
  }
  // 池子太小（比如用户只学了三个词）→ 放宽"一个词只出一首"，但歌仍不重复
  for (let i = 0; i < order.length && picked.length < want; i++) {
    const it = order[i];
    if (usedKey[it.key]) continue;
    usedKey[it.key] = true;
    picked.push(it);
  }
  return picked;
}

export { SONG_RAW };
